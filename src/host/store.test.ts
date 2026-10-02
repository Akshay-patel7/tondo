import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, MIGRATIONS, Store } from "./store";
import { IMAGE_FIXTURE } from "../shared/imageFixture";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-store-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function version(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("migrate", () => {
  it("brings a new store to the latest version", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(["draft_images", "projects", "threads", "ui"]);
  });

  it("does nothing to a store that's up to date", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    db.prepare("INSERT INTO projects (path, added_at) VALUES ('/work/a', 1)").run();
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT path FROM projects").all()).toEqual([{ path: "/work/a" }]);
  });

  it("runs only the migrations an older store hasn't had, keeping its data", () => {
    const first = "CREATE TABLE notes (text TEXT NOT NULL) STRICT;";
    const second = "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;";
    const db = new DatabaseSync(":memory:");
    migrate(db, [first]);
    db.prepare("INSERT INTO notes (text) VALUES ('kept')").run();
    migrate(db, [first, second]);
    expect(version(db)).toBe(2);
    expect({ ...db.prepare("SELECT text, pinned FROM notes").get() }).toEqual({
      text: "kept",
      pinned: 0,
    });
  });

  it("migrates Stage 7 drafts without changing their text", () => {
    const file = path.join(dir, "old.sqlite");
    const db = new DatabaseSync(file);
    migrate(db, MIGRATIONS.slice(0, 1));
    db.exec(
      "INSERT INTO projects (path, added_at) VALUES ('/work/a', 1); INSERT INTO threads (id, project_id, created_at, draft) VALUES ('t', 1, 2, 'kept');",
    );
    db.close();
    const store = Store.open(file);
    expect(store.thread("t")).toMatchObject({ draft: "kept", hasImages: false });
    expect(store.draftImages("t")).toEqual([]);
    store.close();
  });

  it("rolls a failed migration back whole and stays at the version before it", () => {
    const db = new DatabaseSync(":memory:");
    const broken = "CREATE TABLE half (x INTEGER); INSERT INTO missing VALUES (1);";
    expect(() => migrate(db, ["CREATE TABLE first (x INTEGER);", broken])).toThrow(
      "Tondo's store failed to migrate to version 2",
    );
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(["first"]);
  });

  it("refuses a store a newer Tondo wrote", () => {
    const file = path.join(dir, "tondo.sqlite");
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    expect(() => Store.open(file)).toThrow(
      expect.objectContaining({
        message: `Can't open Tondo's store ${file}`,
        cause: expect.objectContaining({
          message: expect.stringContaining("A newer Tondo wrote it."),
        }),
      }),
    );
  });
});

describe("Store", () => {
  it("keeps projects, threads and the window's state across a restart", () => {
    const file = path.join(dir, "nested", "tondo.sqlite");
    const store = Store.open(file);
    expect(store.ui()).toEqual({ sidebarHidden: false, openThread: null });
    const project = store.addProject("/work/a", 10);
    expect(store.addProject("/work/a", 20)).toEqual(project);
    store.setCollapsed(project.id, true);
    store.addThread({ id: "t1", projectId: project.id, sessionFile: null, createdAt: 30 });
    store.setSessionFile("t1", "/sessions/t1.jsonl");
    store.setPinned("t1", true);
    store.setArchived("t1", true);
    store.setDraft("t1", "half a thought");
    store.setUi("sidebarHidden", true);
    store.setUi("openThread", "t1");
    store.close();

    const reopened = Store.open(file);
    expect(reopened.projects()).toEqual([
      { id: project.id, path: "/work/a", addedAt: 10, collapsed: true },
    ]);
    expect(reopened.threads()).toEqual([
      {
        id: "t1",
        projectId: project.id,
        sessionFile: "/sessions/t1.jsonl",
        createdAt: 30,
        pinned: true,
        archived: true,
        draft: "half a thought",
        hasImages: false,
      },
    ]);
    expect(reopened.ui()).toEqual({ sidebarHidden: true, openThread: "t1" });
    reopened.close();
  });

  it("keeps image bytes separate from sidebar rows and text saves, and removes them with the thread", () => {
    const file = path.join(dir, "images.sqlite");
    const store = Store.open(file);
    const { id: projectId } = store.addProject("/work/a", 1);
    store.addThread({ id: "t", projectId, sessionFile: null, createdAt: 2 });
    store.setDraftImages("t", [IMAGE_FIXTURE]);
    store.setDraft("t", "a new thought");
    expect(store.thread("t")).toMatchObject({ hasImages: true, draft: "a new thought" });
    expect(JSON.stringify(store.threads())).not.toContain(IMAGE_FIXTURE.data);
    store.close();
    const reopened = Store.open(file);
    expect(reopened.draftImages("t")).toEqual([IMAGE_FIXTURE]);
    reopened.setDraftImages("t", []);
    expect(reopened.thread("t")?.hasImages).toBe(false);
    reopened.setDraftImages("t", [IMAGE_FIXTURE]);
    reopened.removeThread("t");
    expect(reopened.draftImages("t")).toEqual([]);
    reopened.close();
  });

  it("adds a thread only once", () => {
    const store = Store.open(":memory:");
    const { id: projectId } = store.addProject("/work/a", 1);
    store.addThread({ id: "t1", projectId, sessionFile: "/s/first.jsonl", createdAt: 2 });
    store.addThread({ id: "t1", projectId, sessionFile: "/s/second.jsonl", createdAt: 3 });
    expect(store.thread("t1")).toMatchObject({ sessionFile: "/s/first.jsonl", createdAt: 2 });
  });

  it("forgets a thread", () => {
    const store = Store.open(":memory:");
    const { id: projectId } = store.addProject("/work/a", 1);
    store.addThread({ id: "t1", projectId, sessionFile: null, createdAt: 2 });
    store.addThread({ id: "t2", projectId, sessionFile: null, createdAt: 3 });
    store.removeThread("t1");
    store.removeThread("never-added");
    expect(store.threads().map((thread) => thread.id)).toEqual(["t2"]);
  });

  it("forgets a removed project's threads", () => {
    const store = Store.open(":memory:");
    const a = store.addProject("/work/a", 1);
    const b = store.addProject("/work/b", 2);
    store.addThread({ id: "a1", projectId: a.id, sessionFile: null, createdAt: 3 });
    store.addThread({ id: "b1", projectId: b.id, sessionFile: null, createdAt: 4 });
    store.removeProject(a.id);
    expect(store.projects().map((project) => project.path)).toEqual(["/work/b"]);
    expect(store.threads().map((thread) => thread.id)).toEqual(["b1"]);
  });

  it("says so when asked to change a thread it doesn't have", () => {
    const store = Store.open(":memory:");
    expect(() => store.setPinned("nope", true)).toThrow("Tondo's store has no thread nope");
    expect(store.thread("nope")).toBeUndefined();
  });
});
