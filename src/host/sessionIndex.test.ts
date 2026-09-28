import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionIndex, TITLE_LENGTH } from "./sessionIndex";

let dir: string;
let folder: { dir: string; shared: boolean };
const project = "/work/app";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-index-")));
  folder = { dir: path.join(dir, "sessions"), shared: false };
  mkdirSync(folder.dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CREATED = "2026-09-01T10:00:00.000Z";
const ASKED = Date.parse("2026-09-01T10:01:00.000Z");
const ANSWERED = Date.parse("2026-09-01T10:02:00.000Z");

function header(id: string, extra: Record<string, unknown> = {}) {
  return { type: "session", version: 3, id, timestamp: CREATED, cwd: project, ...extra };
}

function message(role: string, content: unknown, timestamp: number) {
  return {
    type: "message",
    id: `m${timestamp}`,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content, timestamp },
  };
}

const user = (text: string, timestamp = ASKED) =>
  message("user", [{ type: "text", text }], timestamp);
const assistant = (text: string, timestamp = ANSWERED) =>
  message("assistant", [{ type: "text", text }], timestamp);
const named = (name?: string) => ({
  type: "session_info",
  id: "i1",
  parentId: null,
  timestamp: CREATED,
  ...(name === undefined ? {} : { name }),
});

/** Writes a session file whose lines are `entries`, as JSON unless they're already strings. */
function write(name: string, entries: unknown[]): string {
  const file = path.join(folder.dir, name);
  const lines = entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

describe("SessionIndex", () => {
  it("reads a session's id, folder, times, name and first message", async () => {
    const file = write("a.jsonl", [
      header("s1"),
      { type: "model_change", id: "c1", parentId: null, timestamp: CREATED, provider: "faux" },
      user("Fix the build"),
      assistant("Fixed."),
      named("Build fix"),
    ]);
    expect(await new SessionIndex().list(project, folder)).toEqual([
      {
        id: "s1",
        file,
        cwd: project,
        createdAt: Date.parse(CREATED),
        updatedAt: ANSWERED,
        name: "Build fix",
        firstMessage: "Fix the build",
      },
    ]);
  });

  it("reads version 1 files, whose header and entries have fewer fields", async () => {
    write("v1.jsonl", [
      { type: "session", id: "old", timestamp: CREATED, cwd: project },
      { type: "message", timestamp: CREATED, message: { role: "user", content: "Hi there" } },
    ]);
    expect(await new SessionIndex().list(project, folder)).toMatchObject([
      { id: "old", firstMessage: "Hi there", updatedAt: Date.parse(CREATED) },
    ]);
  });

  it("skips files that don't start with a session header, as pi does", async () => {
    write("model-first.jsonl", [{ type: "model_change" }, header("late")]);
    write("number-id.jsonl", [header("x", { id: 7 })]);
    write("empty.jsonl", []);
    writeFileSync(path.join(folder.dir, "notes.json"), JSON.stringify(header("json")));
    // Blank and malformed lines before the header don't count.
    write("padded.jsonl", ["", "{not json", header("padded")]);
    const ids = (await new SessionIndex().list(project, folder)).map((summary) => summary.id);
    expect(ids).toEqual(["padded"]);
  });

  it("takes the name from the last session_info entry, and a cleared name clears it", async () => {
    write("renamed.jsonl", [header("a"), named("First"), user("Hi"), named("Second")]);
    write("cleared.jsonl", [header("b"), named("First"), named("  ")]);
    write("dropped.jsonl", [header("c"), named("First"), named()]);
    // Text that happens to be "session_info" isn't a name.
    write("mention.jsonl", [header("d"), named("Kept"), user("session_info")]);
    const names = (await new SessionIndex().list(project, folder)).map((s) => [s.id, s.name]);
    expect(names).toEqual([
      ["b", undefined],
      ["c", undefined],
      ["d", "Kept"],
      ["a", "Second"],
    ]);
  });

  it("takes the first thing you asked with text in it, on one line", async () => {
    const long = "word ".repeat(40);
    write("a.jsonl", [
      header("a"),
      message("user", [{ type: "image", data: "", mimeType: "image/png" }], ASKED),
      message(
        "user",
        [
          { type: "text", text: "Look\n  at" },
          { type: "text", text: "this" },
        ],
        ASKED,
      ),
      user("Second question"),
    ]);
    write("b.jsonl", [header("b"), message("user", long, ASKED)]);
    write("c.jsonl", [header("c")]);
    const summaries = await new SessionIndex().list(project, folder);
    expect(summaries.map((summary) => summary.firstMessage)).toEqual([
      "Look at this",
      `${long.trim().slice(0, TITLE_LENGTH - 1)}…`,
      "",
    ]);
  });

  it("dates a thread by its last message from you or pi", async () => {
    write("a.jsonl", [
      header("a"),
      user("Run it"),
      assistant("Running.", ANSWERED),
      message("toolResult", [{ type: "text", text: "ok" }], ANSWERED + 5000),
      named("Later entries don't count"),
    ]);
    // Without a message's own time, the entry's counts.
    write("b.jsonl", [
      header("b"),
      {
        type: "message",
        timestamp: new Date(ASKED).toISOString(),
        message: { role: "user", content: "x" },
      },
    ]);
    write("c.jsonl", [header("c")]);
    const d = write("d.jsonl", [header("d", { timestamp: "not a time" })]);
    const summaries = await new SessionIndex().list(project, folder);
    expect(summaries.map((summary) => summary.updatedAt)).toEqual([
      ANSWERED,
      ASKED,
      Date.parse(CREATED),
      statSync(d).mtimeMs,
    ]);
    expect(summaries[3]!.createdAt).toBe(statSync(d).mtimeMs);
  });

  it("lists only the project's sessions from a shared folder", async () => {
    write("mine.jsonl", [header("mine")]);
    write("theirs.jsonl", [header("theirs", { cwd: "/work/other" })]);
    write("nowhere.jsonl", [header("nowhere", { cwd: undefined })]);
    const index = new SessionIndex();
    const ids = async (shared: boolean) =>
      (await index.list(project, { ...folder, shared })).map((summary) => summary.id);
    expect(await ids(true)).toEqual(["mine"]);
    expect(await ids(false)).toEqual(["mine", "nowhere", "theirs"]);
  });

  it("reads a file again only after its size or modification time changes", async () => {
    // A whole second, which the file system stores exactly.
    const time = new Date("2026-09-01T12:00:00.000Z");
    const file = write("a.jsonl", [header("a"), named("Old")]);
    utimesSync(file, time, time);
    const index = new SessionIndex();
    expect((await index.list(project, folder))[0]!.name).toBe("Old");
    // Same size and time: the index keeps what it read.
    write("a.jsonl", [header("a"), named("New")]);
    utimesSync(file, time, time);
    expect((await index.list(project, folder))[0]!.name).toBe("Old");
    appendFileSync(file, `${JSON.stringify(named("Newest"))}\n`);
    expect((await index.list(project, folder))[0]!.name).toBe("Newest");
  });

  it("drops a session whose file is gone", async () => {
    const file = write("a.jsonl", [header("a")]);
    write("b.jsonl", [header("b")]);
    const index = new SessionIndex();
    expect(await index.list(project, folder)).toHaveLength(2);
    rmSync(file);
    expect((await index.list(project, folder)).map((summary) => summary.id)).toEqual(["b"]);
    expect(await index.summary(file)).toBeNull();
  });

  it("lists nothing from a folder pi hasn't made yet", async () => {
    const missing = { dir: path.join(dir, "missing"), shared: false };
    expect(await new SessionIndex().list(project, missing)).toEqual([]);
  });

  it("says which folder it can't read", async () => {
    const notAFolder = write("file.jsonl", [header("a")]);
    await expect(
      new SessionIndex().list(project, { dir: notAFolder, shared: false }),
    ).rejects.toThrow(`Can't read pi's session folder ${notAFolder}`);
  });
});
