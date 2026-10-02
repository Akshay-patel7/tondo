// Tondo's own records, kept in SQLite in the app data folder: the projects you
// added, which pi session file each thread uses, pins, archives, drafts and
// the sidebar's state. The session files themselves are pi's, and Tondo only
// reads them.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DraftImage } from "../shared/images";

/**
 * Migration n takes the store from version n to n + 1. A store's version is
 * the number of migrations it has had. Never change a migration that shipped:
 * add another.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE projects (
     id INTEGER PRIMARY KEY,
     path TEXT NOT NULL UNIQUE,
     added_at INTEGER NOT NULL,
     collapsed INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TABLE threads (
     id TEXT PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     session_file TEXT,
     created_at INTEGER NOT NULL,
     pinned INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     draft TEXT NOT NULL DEFAULT ''
   ) STRICT;
   CREATE INDEX threads_by_project ON threads (project_id);
   CREATE TABLE ui (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;`,
  `CREATE TABLE draft_images (
     thread_id TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
     images TEXT NOT NULL
   ) STRICT;`,
];

/** Brings `db` up to date with `migrations`, one transaction per migration. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): void {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  if (version > migrations.length) {
    throw new Error(
      `Tondo's store is at version ${version}, but this Tondo knows only ${migrations.length}. A newer Tondo wrote it.`,
    );
  }
  for (let next = version; next < migrations.length; next++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migrations[next]!);
      // SQLite rolls user_version back with the rest if the commit fails.
      db.exec(`PRAGMA user_version = ${next + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Tondo's store failed to migrate to version ${next + 1}`, { cause: error });
    }
  }
}

export interface StoredProject {
  readonly id: number;
  /** The folder's realpath, which is where pi runs. */
  readonly path: string;
  readonly addedAt: number;
  /** Whether the sidebar hides the project's threads. */
  readonly collapsed: boolean;
}

/**
 * A thread Tondo has something to remember about. Sessions you started in
 * pi's own interface show in the sidebar without one until you pin, archive,
 * open or draft in them.
 */
export interface StoredThread {
  /** pi's session id. */
  readonly id: string;
  readonly projectId: number;
  /** Where pi keeps the session. pi writes it with the first reply, so it may not exist yet. */
  readonly sessionFile: string | null;
  readonly createdAt: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** What you were writing in the composer. */
  readonly draft: string;
  readonly hasImages: boolean;
}

/** The window's state that outlives a restart. */
export interface StoredUi {
  readonly sidebarHidden: boolean;
  /** The thread on screen, to open again at the next start. */
  readonly openThread: string | null;
}

const UI_DEFAULTS: StoredUi = { sidebarHidden: false, openThread: null };

interface ProjectRow {
  id: number;
  path: string;
  added_at: number;
  collapsed: number;
}

interface ThreadRow {
  id: string;
  project_id: number;
  session_file: string | null;
  created_at: number;
  pinned: number;
  archived: number;
  draft: string;
  has_images: number;
}

function toProject(row: ProjectRow): StoredProject {
  return {
    id: row.id,
    path: row.path,
    addedAt: row.added_at,
    collapsed: row.collapsed === 1,
  };
}

function toThread(row: ThreadRow): StoredThread {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionFile: row.session_file,
    createdAt: row.created_at,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    draft: row.draft,
    hasImages: row.has_images === 1,
  };
}

export class Store {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** Opens the store in `file`, creating it and its folder if they don't exist. `:memory:` works for tests. */
  static open(file: string): Store {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      // With WAL, NORMAL keeps the store whole through a crash and skips a sync on every draft you type.
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec("PRAGMA foreign_keys = ON");
      migrate(db);
    } catch (error) {
      db.close();
      throw new Error(`Can't open Tondo's store ${file}`, { cause: error });
    }
    return new Store(db);
  }

  close(): void {
    this.db.close();
  }

  projects(): StoredProject[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY id").all() as unknown[];
    return (rows as ProjectRow[]).map(toProject);
  }

  /** Adds the project at `folder`, a realpath, or returns it if you added it before. */
  addProject(folder: string, now: number): StoredProject {
    this.db
      .prepare("INSERT INTO projects (path, added_at) VALUES (?, ?) ON CONFLICT (path) DO NOTHING")
      .run(folder, now);
    const row = this.db.prepare("SELECT * FROM projects WHERE path = ?").get(folder);
    return toProject(row as unknown as ProjectRow);
  }

  /** Forgets the project and what Tondo kept about its threads. pi's session files stay. */
  removeProject(id: number): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  setCollapsed(projectId: number, collapsed: boolean): void {
    this.db
      .prepare("UPDATE projects SET collapsed = ? WHERE id = ?")
      .run(collapsed ? 1 : 0, projectId);
  }

  threads(): StoredThread[] {
    const rows = this.db
      .prepare(
        "SELECT threads.*, EXISTS(SELECT 1 FROM draft_images WHERE thread_id = threads.id) AS has_images FROM threads ORDER BY created_at, id",
      )
      .all() as unknown[];
    return (rows as ThreadRow[]).map(toThread);
  }

  thread(id: string): StoredThread | undefined {
    const row = this.db
      .prepare(
        "SELECT threads.*, EXISTS(SELECT 1 FROM draft_images WHERE thread_id = threads.id) AS has_images FROM threads WHERE id = ?",
      )
      .get(id);
    return row ? toThread(row as unknown as ThreadRow) : undefined;
  }

  /** Remembers a thread, unless Tondo already does. */
  addThread(thread: Pick<StoredThread, "id" | "projectId" | "sessionFile" | "createdAt">): void {
    this.db
      .prepare(
        `INSERT INTO threads (id, project_id, session_file, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .run(thread.id, thread.projectId, thread.sessionFile, thread.createdAt);
  }

  /** Forgets a thread, such as a new one you left without writing anything. */
  removeThread(threadId: string): void {
    this.db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  }

  setSessionFile(threadId: string, file: string): void {
    this.update(threadId, "session_file", file);
  }

  setPinned(threadId: string, pinned: boolean): void {
    this.update(threadId, "pinned", pinned ? 1 : 0);
  }

  setArchived(threadId: string, archived: boolean): void {
    this.update(threadId, "archived", archived ? 1 : 0);
  }

  setDraft(threadId: string, draft: string): void {
    this.update(threadId, "draft", draft);
  }

  /** Image bytes are read only for an open draft or a send, never for the sidebar. */
  draftImages(threadId: string): DraftImage[] {
    const row = this.db
      .prepare("SELECT images FROM draft_images WHERE thread_id = ?")
      .get(threadId) as { images: string } | undefined;
    return row ? (JSON.parse(row.images) as DraftImage[]) : [];
  }

  setDraftImages(threadId: string, images: readonly DraftImage[]): void {
    if (images.length === 0) {
      this.db.prepare("DELETE FROM draft_images WHERE thread_id = ?").run(threadId);
    } else {
      this.db
        .prepare(
          "INSERT INTO draft_images (thread_id, images) VALUES (?, ?) ON CONFLICT (thread_id) DO UPDATE SET images = excluded.images",
        )
        .run(threadId, JSON.stringify(images));
    }
  }

  ui(): StoredUi {
    const rows = this.db.prepare("SELECT key, value FROM ui").all() as unknown[];
    const stored: Record<string, unknown> = {};
    for (const { key, value } of rows as { key: string; value: string }[]) {
      stored[key] = JSON.parse(value);
    }
    return {
      sidebarHidden:
        typeof stored.sidebarHidden === "boolean"
          ? stored.sidebarHidden
          : UI_DEFAULTS.sidebarHidden,
      openThread:
        typeof stored.openThread === "string" ? stored.openThread : UI_DEFAULTS.openThread,
    };
  }

  setUi<K extends keyof StoredUi>(key: K, value: StoredUi[K]): void {
    this.db
      .prepare(
        "INSERT INTO ui (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  private update(
    threadId: string,
    column: "session_file" | "pinned" | "archived" | "draft",
    value: string | number,
  ): void {
    const { changes } = this.db
      .prepare(`UPDATE threads SET ${column} = ? WHERE id = ?`)
      .run(value, threadId);
    if (changes === 0) throw new Error(`Tondo's store has no thread ${threadId}`);
  }
}
