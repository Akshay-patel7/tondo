import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION as v, type HostMessage } from "../shared/protocol";
import type { PaletteSetting, SettingsPatch, ThemeSetting } from "../shared/settings";
import type { ThreadListener } from "./liveThread";
import { readSettings, readSettingsLeniently, updateSettings } from "./settings";
import { Store } from "./store";
import { TrustNotSavedError, type Supervisor } from "./supervisor";
import { Terminals } from "./terminals";
import { Workspace } from "./workspace";

// Workspace runs real pi through LiveThread. These tests stand in for it, and
// keep everything else Workspace builds on real: the store, settings.json,
// file listing through git, and the worktree ledger.
const { FakeThread, threads } = vi.hoisted(() => {
  class Fake {
    readonly id: string;
    readonly projectId: number;
    readonly project: string;
    readonly sessionFile: string | null;
    readonly listener: ThreadListener;
    readonly checkpoints: unknown;
    readonly status = { state: "ready" };
    readonly state = { messages: [], running: false, compaction: null, retry: null };
    readonly ui = {};
    readonly waiting = false;
    readonly busy = false;
    readonly preparing = false;
    readonly askingTrust = false;
    readonly name = undefined;
    readonly updatedAt = undefined;
    visible = false;
    lastUsed = 0;
    readonly open = vi.fn(async () => {});
    readonly close = vi.fn(async () => {});
    readonly trust = vi.fn(async (_trusted: boolean) => {});

    constructor(
      project: { id: number; path: string },
      session: { id: string; file: string | null },
      _supervisor: unknown,
      listener: ThreadListener,
      checkpoints: unknown,
    ) {
      this.id = session.id;
      this.projectId = project.id;
      this.project = project.path;
      this.sessionFile = session.file;
      this.listener = listener;
      this.checkpoints = checkpoints;
      made.push(this);
    }

    show(): void {
      this.visible = true;
    }

    hide(): void {
      this.visible = false;
    }

    snapshot(): unknown {
      return this.state;
    }
  }
  const made: Fake[] = [];
  return { FakeThread: Fake, threads: made };
});

vi.mock("./liveThread", () => ({ LiveThread: FakeThread }));

let dir: string;
let settingsFile: string;
let store: Store;
let sent: HostMessage[];
let waiters: { match: (message: HostMessage) => boolean; resolve: (m: HostMessage) => void }[];
let reveal: ReturnType<typeof vi.fn<(file: string) => void>>;
let setTheme: ReturnType<typeof vi.fn<(theme: ThemeSetting, palette: PaletteSetting) => void>>;
let workspace: Workspace;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  threads.length = 0;
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-workspace-")));
  settingsFile = path.join(dir, "settings.json");
  store = Store.open(path.join(dir, "tondo.db"));
  sent = [];
  waiters = [];
  reveal = vi.fn<(file: string) => void>();
  setTheme = vi.fn<(theme: ThemeSetting, palette: PaletteSetting) => void>();
  const supervisor = {
    settingsFile,
    settings: () => readSettings(settingsFile),
    readableSettings: () => readSettingsLeniently(settingsFile),
    updateSettings: (patch: SettingsPatch) => updateSettings(settingsFile, patch),
    checkPi: async () => {},
    discover: async () => ({ found: false }),
    captureLoginEnv: async () => ({}),
    needsTrustAnswer: async () => false,
  };
  workspace = new Workspace({
    userData: dir,
    gitGroups: () => {},
    store,
    supervisor: supervisor as unknown as Supervisor,
    poolOverride: { maxLive: 12, idleMs: 2_000_000_000 },
    send: (message) => {
      sent.push(message);
      for (const waiter of waiters.filter(({ match }) => match(message))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    },
    chooseFolder: () => {},
    choosePi: () => {},
    setTheme,
    attention: () => {},
    copy: () => {},
    reveal,
    terminalGroups: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The next message `match` accepts. Register it before the action that sends it. */
function next(match: (message: HostMessage) => boolean): Promise<HostMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const types = sent.map((message) => message.type).join(", ");
      reject(new Error(`No matching message. Sent: ${types}`));
    }, 5_000);
    waiters.push({
      match,
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

const isError = (message: HostMessage) => message.type === "error";

/** A folder with its own git repository holding `files`, untracked. */
function repository(name: string, files: readonly string[]): string {
  const folder = path.join(dir, name);
  mkdirSync(folder);
  execFileSync("git", ["init", "-q"], { cwd: folder });
  for (const file of files) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), "");
  }
  return folder;
}

function addThread(projectId: number, id: string): void {
  store.addThread({ id, projectId, sessionFile: null, createdAt: 1 });
}

async function openThread(id: string): Promise<InstanceType<typeof FakeThread>> {
  const shown = next(
    (message) => isError(message) || (message.type === "snapshot" && message.thread?.id === id),
  );
  workspace.handle({ v, type: "open-thread", threadId: id });
  expect((await shown).type).toBe("snapshot");
  return threads.find((thread) => thread.id === id)!;
}

describe("settings messages", () => {
  it("reports a settings.json Tondo can't read as fileProblem, with no change error", async () => {
    writeFileSync(settingsFile, "{ not json");
    const settings = next((message) => message.type === "settings");
    workspace.greet();
    const message = await settings;
    expect(message).toMatchObject({ type: "settings", error: null });
    if (message.type !== "settings") return;
    expect(message.fileProblem?.path).toBe(settingsFile);
    expect(message.fileProblem?.message).toContain("isn't valid JSON");
    workspace.handle({ v, type: "reveal", path: settingsFile });
    expect(reveal).toHaveBeenCalledWith(settingsFile);
  });

  it("reports a refused change as error, with no fileProblem, and keeps the file", async () => {
    writeFileSync(settingsFile, "{}\n");
    const settings = next((message) => message.type === "settings");
    workspace.handle({ v, type: "set-settings", patch: { pool: { maxLive: 99 } } });
    const message = await settings;
    expect(message).toMatchObject({ type: "settings", fileProblem: null });
    if (message.type !== "settings") return;
    expect(message.error).toMatch(/^Tondo didn't save that change\. It has a pool\.maxLive /);
    expect(message.settings.pool.maxLive).toBe(4);
    expect(readFileSync(settingsFile, "utf8")).toBe("{}\n");
  });

  it("sends a palette change to the page and main without changing the scheme", async () => {
    writeFileSync(settingsFile, JSON.stringify({ theme: "dark" }));
    workspace.applySettings();
    expect(setTheme.mock.calls).toEqual([["dark", "default"]]);

    const changed = next((message) => message.type === "settings");
    workspace.handle({ v, type: "set-settings", patch: { palette: "ocean" } });
    expect(await changed).toMatchObject({
      type: "settings",
      error: null,
      settings: { theme: "dark", palette: "ocean" },
    });
    expect(setTheme.mock.calls).toEqual([
      ["dark", "default"],
      ["dark", "ocean"],
    ]);
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({
      theme: "dark",
      palette: "ocean",
    });

    // A new page, as after a reload, gets the saved palette.
    const greeted = next((message) => message.type === "settings");
    workspace.greet();
    expect(await greeted).toMatchObject({ settings: { theme: "dark", palette: "ocean" } });
  });
});

describe("find-files", () => {
  it("searches the thread's worktree checkout and answers with the request's id and query", async () => {
    const project = repository("project", ["project-only.ts"]);
    const worktree = repository("worktree", ["src/worktree-only.ts"]);
    const { id: projectId } = store.addProject(project, 1);
    addThread(projectId, "thread-a");
    store.addWorktree({ path: worktree, repository: project, branch: "b", threadId: "thread-a" });
    const matches = next((message) => isError(message) || message.type === "file-matches");
    workspace.handle({ v, type: "find-files", threadId: "thread-a", id: 7, query: "only" });
    expect(await matches).toEqual({
      v,
      type: "file-matches",
      threadId: "thread-a",
      id: 7,
      query: "only",
      paths: ["src/worktree-only.ts"],
    });
  });
});

describe("a project folder deleted outside Tondo", () => {
  it("still lets you remove the project, stopping its thread", async () => {
    const project = path.join(dir, "gone");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 1);
    addThread(projectId, "thread-a");
    const thread = await openThread("thread-a");
    rmSync(project, { recursive: true });
    const removed = next(
      (message) =>
        isError(message) ||
        (message.type === "sidebar" && !message.projects.some(({ id }) => id === projectId)),
    );
    workspace.handle({ v, type: "remove-project", projectId });
    expect((await removed).type).toBe("sidebar");
    expect(thread.close).toHaveBeenCalledTimes(1);
    expect(store.projects()).toEqual([]);
    expect(store.threads()).toEqual([]);
    expect(sent).toContainEqual(expect.objectContaining({ type: "snapshot", thread: null }));
  });

  it("forgets an unused thread you leave", async () => {
    const project = path.join(dir, "gone");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 1);
    addThread(projectId, "thread-a");
    addThread(projectId, "thread-b");
    const left = await openThread("thread-a");
    rmSync(project, { recursive: true });
    const forgotten = next(
      (message) =>
        isError(message) ||
        (message.type === "sidebar" &&
          !message.projects[0]!.threads.some(({ id }) => id === "thread-a")),
    );
    await openThread("thread-b");
    expect((await forgotten).type).toBe("sidebar");
    expect(left.close).toHaveBeenCalledTimes(1);
    expect(store.thread("thread-a")).toBeUndefined();
    expect(store.thread("thread-b")).toBeDefined();
  });
});

/** The sidebar once its only thread's archived flag is `value`, or an error. */
function archived(value: boolean): Promise<HostMessage> {
  return next(
    (message) =>
      isError(message) ||
      (message.type === "sidebar" && message.projects[0]!.threads[0]!.archived === value),
  );
}

describe("archive-thread", () => {
  it("closes the thread's terminal when archiving, and not when unarchiving", async () => {
    const close = vi.spyOn(Terminals.prototype, "close");
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "thread-a");
    const hidden = archived(true);
    workspace.handle({ v, type: "archive-thread", threadId: "thread-a", archived: true });
    expect((await hidden).type).toBe("sidebar");
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("thread-a");
    const shown = archived(false);
    workspace.handle({ v, type: "archive-thread", threadId: "thread-a", archived: false });
    expect((await shown).type).toBe("sidebar");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("editorText from an extension", () => {
  beforeEach(() => {
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "thread-a");
    addThread(projectId, "thread-b");
    store.setDraft("thread-a", "what I typed");
  });

  it("appends to the stored draft of a thread that isn't on screen", async () => {
    const hidden = await openThread("thread-a");
    await openThread("thread-b");
    sent.length = 0;
    hidden.listener.editorText("/deploy prod");
    expect(store.thread("thread-a")?.draft).toBe("what I typed\n\n/deploy prod");
    expect(sent.filter((message) => message.type === "editor-text")).toEqual([]);
  });

  it("keeps what you typed when an extension sets a hidden thread's text again", async () => {
    const hidden = await openThread("thread-a");
    await openThread("thread-b");
    hidden.listener.editorText("one");
    hidden.listener.editorText("two");
    expect(store.thread("thread-a")?.draft).toBe("what I typed\n\ntwo");
  });

  it("sends the text to the page for the thread on screen, leaving the stored draft", async () => {
    const visible = await openThread("thread-a");
    sent.length = 0;
    visible.listener.editorText("/deploy prod");
    expect(sent).toEqual([{ v, type: "editor-text", threadId: "thread-a", text: "/deploy prod" }]);
    expect(store.thread("thread-a")?.draft).toBe("what I typed");
  });
});

describe("trust", () => {
  it("shows an answer Tondo couldn't save as an error toast that can reveal settings.json", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "thread-a");
    const thread = await openThread("thread-a");
    thread.trust.mockRejectedValueOnce(
      new TrustNotSavedError(settingsFile, new Error("EACCES: permission denied")),
    );
    const told = next((message) => isError(message) || message.type === "toast");
    workspace.handle({ v, type: "trust", threadId: "thread-a", trusted: true });
    expect(await told).toEqual({
      v,
      type: "toast",
      level: "error",
      message: "Tondo couldn't save your answer. EACCES: permission denied",
      reveal: settingsFile,
    });
    expect(thread.trust).toHaveBeenCalledWith(true);
    workspace.handle({ v, type: "reveal", path: settingsFile });
    expect(reveal).toHaveBeenCalledWith(settingsFile);
  });
});
