import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION as v, type HostMessage, type PiStatus } from "../shared/protocol";
import type { PiMessage } from "../shared/thread";
import type { PaletteSetting, SettingsPatch, ThemeSetting } from "../shared/settings";
import type { ThreadListener } from "./liveThread";
import { readSettings, readSettingsLeniently, updateSettings } from "./settings";
import { Store } from "./store";
import { TrustNotSavedError, type Supervisor } from "./supervisor";
import { Terminals } from "./terminals";
import { TerminalContext, terminalContextSuffix } from "./terminalContext";
import { Workspace } from "./workspace";
import { IMAGE_FIXTURE } from "../shared/imageFixture";
import { SessionIndex } from "./sessionIndex";
import { captureCheckpoint } from "./checkpoints";

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
    readonly checkpoints: { readonly busy: boolean };
    status: PiStatus = {
      state: "ready",
      session: {
        model: null,
        models: [],
        thinkingLevel: "off",
        thinkingLevels: ["off"],
        context: null,
        commands: [],
        signedIn: false,
      },
    };
    readonly state = { messages: [] as PiMessage[], running: false, compaction: null, retry: null };
    readonly ui = {};
    readonly waiting = false;
    working = false;
    get busy(): boolean {
      return this.working || this.checkpoints.busy;
    }
    readonly preparing = false;
    readonly askingTrust = false;
    readonly name = undefined;
    readonly updatedAt = undefined;
    visible = false;
    lastUsed = 0;
    readonly open = vi.fn(async () => {});
    readonly close = vi.fn(async () => {});
    readonly trust = vi.fn(async (_trusted: boolean) => {});
    readonly prompt = vi.fn(async () => {});

    constructor(
      project: { id: number; path: string },
      selection: { id: string; file: string | null },
      _supervisor: unknown,
      listener: ThreadListener,
      checkpoints: { readonly busy: boolean },
    ) {
      this.id = selection.id;
      this.projectId = project.id;
      this.project = project.path;
      this.sessionFile = selection.file;
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
  const commandPath = process.env.PATH;
  if (!commandPath) throw new Error("Workspace tests require PATH to find Git.");
  // Match the Git fixtures: retain the runner's Git, without reading user config.
  const gitEnv = {
    PATH: commandPath,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const supervisor = {
    settingsFile,
    settings: () => readSettings(settingsFile),
    readableSettings: () => readSettingsLeniently(settingsFile),
    updateSettings: (patch: SettingsPatch) => updateSettings(settingsFile, patch),
    checkPi: async () => {},
    discover: async () => ({ found: false }),
    captureLoginEnv: async () => gitEnv,
    needsTrustAnswer: async () => false,
    sessionFolder: async () => ({ dir: path.join(dir, "sessions"), shared: true }),
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
    chooseFiles: () => {},
    setTheme,
    attention: () => {},
    copy: () => {},
    reveal,
    terminalGroups: () => {},
  });
});

afterEach(() => {
  workspace.disconnected();
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

describe("saved history requests", () => {
  it("routes only the visible thread's saved file and rejects stale revisions", async () => {
    const project = store.addProject(dir, 1);
    const file = session("history-thread", project.id);
    const records = [
      {
        type: "message",
        id: "old",
        parentId: null,
        timestamp: "2026-10-26",
        message: { role: "user", content: "Saved original", timestamp: 1 },
      },
      {
        type: "message",
        id: "live",
        parentId: "old",
        timestamp: "2026-10-26",
        message: { role: "user", content: "Retained", timestamp: 2 },
      },
      {
        type: "compaction",
        id: "compact",
        parentId: "live",
        timestamp: "2026-10-26",
        summary: "Summary",
        firstKeptEntryId: "live",
      },
    ];
    writeFileSync(
      file,
      readFileSync(file, "utf8") +
        records.map((record) => JSON.stringify(record)).join("\n") +
        "\n",
    );
    await openThread("history-thread");
    const indexed = next((message) => message.type === "history-result" && message.id === "index");
    workspace.handle({ v, type: "history-index", threadId: "history-thread", id: "index" });
    const response = await indexed;
    expect(response).toMatchObject({
      type: "history-result",
      threadId: "history-thread",
      result: { kind: "index", index: { prompts: ["old"] } },
      error: null,
    });
    if (response.type !== "history-result" || response.result?.kind !== "index")
      throw new Error("Expected history index");
    const revision = response.result.index.revision;
    const loaded = next((message) => message.type === "history-result" && message.id === "page");
    workspace.handle({
      v,
      type: "history-page",
      threadId: "history-thread",
      id: "page",
      revision,
      entryId: "old",
    });
    expect(await loaded).toMatchObject({
      result: {
        kind: "page",
        page: { messages: [{ content: "Saved original" }, { content: "Retained" }] },
      },
      error: null,
    });
    const stale = next((message) => message.type === "history-result" && message.id === "stale");
    workspace.handle({
      v,
      type: "history-preview",
      threadId: "history-thread",
      id: "stale",
      revision: "stale",
      entryId: "old",
    });
    expect(await stale).toMatchObject({ result: null, error: expect.stringContaining("changed") });
    addThread(project.id, "other");
    await openThread("other");
    const count = sent.filter((message) => message.type === "history-result").length;
    workspace.handle({ v, type: "history-index", threadId: "history-thread", id: "background" });
    expect(sent.filter((message) => message.type === "history-result")).toHaveLength(count);
  });
});

describe("terminal sharing", () => {
  it("saves the opt-in per thread, broadcasts it, and restores it on reconnect", async () => {
    const project = store.addProject(dir, 1);
    addThread(project.id, "shared");
    addThread(project.id, "private");
    await openThread("shared");
    workspace.handle({ v, type: "terminal-sharing", threadId: "shared", enabled: true });
    expect(store.thread("shared")?.shareTerminalOutput).toBe(true);
    expect(store.thread("private")?.shareTerminalOutput).toBe(false);
    expect(sent.at(-1)).toMatchObject({
      type: "terminal-context",
      threadId: "shared",
      enabled: true,
      pending: false,
    });
    sent.length = 0;
    const git = next((message) => message.type === "git-status");
    workspace.greet();
    expect(sent).toContainEqual(
      expect.objectContaining({ type: "terminal-context", threadId: "shared", enabled: true }),
    );
    await git;
    workspace.handle({ v, type: "terminal-sharing", threadId: "shared", enabled: false });
    expect(store.thread("shared")?.shareTerminalOutput).toBe(false);
  });

  it("attaches reserved output only to ordinary prompts and restores it on rejection", async () => {
    const project = store.addProject(dir, 1);
    addThread(project.id, "thread");
    const live = await openThread("thread");
    const context = new TerminalContext(true);
    context.append("command output");
    const attachment = context.take()!;
    const take = vi.spyOn(Terminals.prototype, "takeContext").mockReturnValue(attachment);
    const restore = vi.spyOn(Terminals.prototype, "restoreContext");
    const accepted = Promise.withResolvers<void>();
    live.prompt.mockImplementationOnce(() => accepted.promise);
    workspace.handle({
      v,
      type: "prompt",
      threadId: "thread",
      text: "That failed",
      streamingBehavior: "followUp",
    });
    expect(live.prompt).toHaveBeenCalledWith(
      "That failed",
      "followUp",
      [],
      terminalContextSuffix(attachment),
    );
    accepted.resolve();
    await accepted.promise;
    expect(restore).not.toHaveBeenCalled();
    live.prompt.mockRejectedValueOnce(new Error("pi refused"));
    const error = next(isError);
    workspace.handle({
      v,
      type: "prompt",
      threadId: "thread",
      text: "Retry",
      streamingBehavior: "steer",
    });
    expect(await error).toMatchObject({ message: "pi refused" });
    expect(restore).toHaveBeenCalledWith("thread", attachment);
    take.mockClear();
    live.prompt.mockResolvedValueOnce();
    workspace.handle({
      v,
      type: "prompt",
      threadId: "thread",
      text: "/deploy",
      streamingBehavior: "steer",
    });
    expect(take).not.toHaveBeenCalled();
    expect(live.prompt).toHaveBeenLastCalledWith("/deploy", "steer", []);
  });
});

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

  it("saves the chosen worktree directory, sends it on reconnect and leaves cancellation alone", async () => {
    const folder = path.join(dir, "custom");
    const changed = next((message) => message.type === "settings");
    workspace.worktreeDirectoryChosen(folder);
    expect(await changed).toMatchObject({ settings: { worktreeDirectory: folder }, error: null });
    workspace.worktreeDirectoryChosen(null);
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).worktreeDirectory).toBe(folder);
    const greeted = next((message) => message.type === "settings");
    workspace.greet();
    expect(await greeted).toMatchObject({ settings: { worktreeDirectory: folder } });
    const reset = next((message) => message.type === "settings");
    workspace.handle({ v, type: "set-settings", patch: { worktreeDirectory: null } });
    expect(await reset).toMatchObject({ settings: { worktreeDirectory: null } });
  });

  it("sends saved panel widths to the page and on reconnect", async () => {
    const changed = next((message) => message.type === "settings");
    workspace.handle({
      v,
      type: "set-settings",
      patch: { panelWidths: { sidebar: 360, changes: 600 } },
    });
    expect(await changed).toMatchObject({
      type: "settings",
      error: null,
      settings: { panelWidths: { sidebar: 360, changes: 600 } },
    });
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).panelWidths).toEqual({
      sidebar: 360,
      changes: 600,
    });
    const greeted = next((message) => message.type === "settings");
    workspace.greet();
    expect(await greeted).toMatchObject({
      settings: { panelWidths: { sidebar: 360, changes: 600 } },
    });
  });

  it("sends the saved expanded thinking setting to the page and on reconnect", async () => {
    const changed = next((message) => message.type === "settings");
    workspace.handle({ v, type: "set-settings", patch: { expandThinking: true } });
    expect(await changed).toMatchObject({
      type: "settings",
      error: null,
      settings: { expandThinking: true },
    });
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).expandThinking).toBe(true);
    const greeted = next((message) => message.type === "settings");
    workspace.greet();
    expect(await greeted).toMatchObject({ settings: { expandThinking: true } });
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

describe("preview-file", () => {
  it("reads from the visible thread's worktree", async () => {
    const project = repository("preview-project", ["report.md"]);
    const checkout = repository("preview-worktree", ["report.md"]);
    writeFileSync(path.join(project, "report.md"), "project");
    writeFileSync(path.join(checkout, "report.md"), "worktree report");
    const { id: projectId } = store.addProject(project, 1);
    addThread(projectId, "preview-thread");
    store.addWorktree({
      root: null,
      path: checkout,
      repository: project,
      branch: "b",
      threadId: "preview-thread",
    });
    await openThread("preview-thread");
    const response = next((message) => isError(message) || message.type === "file-preview");
    workspace.handle({
      v,
      type: "preview-file",
      threadId: "preview-thread",
      id: "request",
      target: "report.md",
    });
    expect(await response).toMatchObject({
      type: "file-preview",
      threadId: "preview-thread",
      id: "request",
      preview: { kind: "text", text: "worktree report", truncated: false },
    });
  });
});

describe("find-files", () => {
  it("searches the thread's worktree checkout and answers with the request's id and query", async () => {
    const project = repository("project", ["project-only.ts"]);
    const worktree = repository("worktree", ["src/worktree-only.ts"]);
    const { id: projectId } = store.addProject(project, 1);
    addThread(projectId, "thread-a");
    store.addWorktree({
      root: null,
      path: worktree,
      repository: project,
      branch: "b",
      threadId: "thread-a",
    });
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

describe("get-project-git", () => {
  it("ignores a removed project's late request and answers the remaining project", async () => {
    const { id: removedId } = store.addProject(dir, 1);
    const project = path.join(dir, "remaining");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 2);
    store.removeProject(removedId);
    const answer = next(
      (message) => message.type === "project-git" && message.projectId === projectId,
    );
    workspace.handle({ v, type: "get-project-git", projectId: removedId });
    workspace.handle({ v, type: "get-project-git", projectId });
    expect(await answer).toEqual({ v, type: "project-git", projectId, git: false, branch: null });
    expect(sent.filter(isError)).toEqual([]);
  });

  it("answers with the project folder's branch before any thread exists", async () => {
    const project = repository("git-project", []);
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/trunk"], { cwd: project });
    const { id: projectId } = store.addProject(project, 1);
    const answer = next((message) => isError(message) || message.type === "project-git");
    workspace.handle({ v, type: "get-project-git", projectId });
    expect(await answer).toEqual({ v, type: "project-git", projectId, git: true, branch: "trunk" });
  });

  it("says a plain folder isn't a Git checkout", async () => {
    const project = path.join(dir, "plain");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 1);
    const answer = next((message) => isError(message) || message.type === "project-git");
    workspace.handle({ v, type: "get-project-git", projectId });
    expect(await answer).toEqual({ v, type: "project-git", projectId, git: false, branch: null });
  });
});

describe("a project folder deleted outside Tondo", () => {
  it("still lets you remove the project, stopping its thread", async () => {
    const project = path.join(dir, "gone");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 1);
    const file = session("thread-a", projectId, project);
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
    expect(existsSync(file)).toBe(true);
    expect(sent).toContainEqual(expect.objectContaining({ type: "snapshot", thread: null }));
  });

  it("forgets an unused thread you leave", async () => {
    const project = path.join(dir, "gone");
    mkdirSync(project);
    const { id: projectId } = store.addProject(project, 1);
    store.addThread({ id: "thread-a", projectId, sessionFile: null, createdAt: 1 }, false);
    addThread(projectId, "thread-b");
    const left = await openThread("thread-a");
    rmSync(project, { recursive: true });
    // The row was already hidden, so deletion need not change the sidebar.
    const forgotten = Promise.withResolvers<void>();
    const remove = store.removeThread.bind(store);
    vi.spyOn(store, "removeThread").mockImplementation((id) => {
      remove(id);
      if (id === "thread-a") forgotten.resolve();
    });
    await openThread("thread-b");
    await forgotten.promise;
    expect(left.close).toHaveBeenCalledTimes(1);
    expect(store.thread("thread-a")).toBeUndefined();
    expect(store.thread("thread-b")).toBeDefined();
  });
});

describe("draft visibility", () => {
  it("keeps a new worktree hidden until meaningful input without forgetting its ownership", async () => {
    const { id: existingId } = await managedSession();
    const projectId = store.thread(existingId)!.projectId;
    addThread(projectId, "local");
    await openThread("local");
    const created = next((message) => message.type === "git-result");
    workspace.handle({
      v,
      type: "git-action",
      threadId: "local",
      id: 1,
      expectedBranch: "main",
      action: { kind: "new-worktree", branch: "empty-worktree", base: "main" },
    });
    expect(await created).toMatchObject({ type: "git-result", error: null });
    const id = store.ui().openThread!;
    expect(store.thread(id)).toMatchObject({ visible: false, sessionFile: null });
    expect(store.worktrees().find((entry) => entry.threadId === id)).toBeDefined();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: expect.not.arrayContaining([expect.objectContaining({ id })]) }],
    });
    expect(store.thread(existingId)?.visible).toBe(true);
    workspace.handle({ v, type: "set-draft", threadId: id, text: " \n\t" });
    await openThread("local");
    await workspace.refresh();
    expect(store.thread(id)?.visible).toBe(false);
    expect(store.worktrees().find((entry) => entry.threadId === id)).toBeDefined();
    await openThread(id);
    workspace.handle({ v, type: "set-draft", threadId: id, text: "Worktree thought" });
    expect(store.thread(id)).toMatchObject({ visible: true, draft: "Worktree thought" });
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: expect.arrayContaining([
            expect.objectContaining({ id, hasDraft: true, worktree: true }),
          ]),
        },
      ],
    });
    await openThread("local");
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: expect.arrayContaining([
            expect.objectContaining({ id, worktree: true }),
            expect.objectContaining({ id: "local", worktree: false }),
          ]),
        },
      ],
    });
    workspace.handle({ v, type: "set-draft", threadId: id, text: "" });
    expect(store.thread(id)?.visible).toBe(true);
  });

  it("reveals an unedited extension suggestion only after pi accepts its submission", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    workspace.handle({ v, type: "new-thread", projectId });
    const id = store.ui().openThread!;
    const liveThread = threads.find((thread) => thread.id === id)!;
    workspace.handle({
      v,
      type: "set-draft",
      threadId: id,
      text: "Extension suggestion",
      userInput: false,
    });
    // Submit clears the composer ahead of sending; no user editor edit revealed it.
    workspace.handle({ v, type: "set-draft", threadId: id, text: "" });
    const accepted = Promise.withResolvers<void>();
    liveThread.prompt.mockImplementationOnce(() => accepted.promise);
    const revealed = next((message) => message.type === "sidebar");
    workspace.handle({
      v,
      type: "prompt",
      threadId: id,
      text: "Extension suggestion",
      streamingBehavior: "steer",
    });
    expect(store.thread(id)?.visible).toBe(false);
    accepted.resolve();
    expect(await revealed).toMatchObject({ projects: [{ threads: [{ id, hasDraft: false }] }] });
    expect(store.thread(id)).toMatchObject({ visible: true, draft: "" });
    expect(liveThread.prompt).toHaveBeenCalledWith("Extension suggestion", "steer", []);
  });

  it("does not latch an extension suggestion when pi rejects its submission", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    workspace.handle({ v, type: "new-thread", projectId });
    const id = store.ui().openThread!;
    const liveThread = threads.find((thread) => thread.id === id)!;
    store.setDraft(id, "Extension suggestion", false);
    liveThread.prompt.mockRejectedValueOnce(new Error("pi rejected the prompt"));
    const rejected = next(isError);
    workspace.handle({
      v,
      type: "prompt",
      threadId: id,
      text: "Extension suggestion",
      streamingBehavior: "steer",
    });
    expect(await rejected).toMatchObject({ type: "error", message: "pi rejected the prompt" });
    expect(store.thread(id)?.visible).toBe(false);
  });

  it("keeps a current draft usable but unlisted until meaningful input", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    workspace.handle({ v, type: "new-thread", projectId });
    const id = store.ui().openThread!;
    expect(sent.find((message) => message.type === "snapshot")).toMatchObject({
      thread: { id },
      draft: "",
    });
    const sidebar = () => sent.findLast((message) => message.type === "sidebar");
    expect(sidebar()).toMatchObject({ projects: [{ threads: [] }] });
    workspace.handle({ v, type: "set-draft", threadId: id, text: " \n\t" });
    workspace.handle({
      v,
      type: "set-draft",
      threadId: id,
      text: "Extension suggestion",
      userInput: false,
    });
    expect(sidebar()).toMatchObject({ projects: [{ threads: [] }] });
    const revealed = next((message) => message.type === "sidebar");
    workspace.handle({ v, type: "set-draft", threadId: id, text: "A thought" });
    expect(await revealed).toMatchObject({ projects: [{ threads: [{ id, hasDraft: true }] }] });
    workspace.handle({ v, type: "set-draft", threadId: id, text: "" });
    workspace.handle({ v, type: "new-thread", projectId });
    expect(sidebar()).toMatchObject({ projects: [{ threads: [{ id, hasDraft: false }] }] });
    expect(store.thread(id)?.visible).toBe(true);
  });

  it("reveals image-only input without requiring a prompt", () => {
    const { id: projectId } = store.addProject(dir, 1);
    workspace.handle({ v, type: "new-thread", projectId });
    const id = store.ui().openThread!;
    workspace.handle({ v, type: "set-draft-images", threadId: id, images: [IMAGE_FIXTURE] });
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: [{ id, hasDraft: true }] }],
    });
  });

  it("keeps resumed records listed before live messages load", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "resumed");
    await openThread("resumed");
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: [{ id: "resumed" }] }],
    });
  });

  it("does not reveal a hidden draft when its offscreen extension sets editor text", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    workspace.handle({ v, type: "new-thread", projectId });
    const id = store.ui().openThread!;
    const liveThread = threads.find((thread) => thread.id === id)!;
    store.setDraft(id, "Extension suggestion", false);
    addThread(projectId, "other");
    await openThread("other");
    liveThread.listener.editorText("Updated extension suggestion");
    expect(store.thread(id)).toMatchObject({
      visible: false,
      draft: "Extension suggestion\n\nUpdated extension suggestion",
    });
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: [{ id: "other" }] }],
    });
  });
});

/** Deletion completion, or a refusal. Register before requesting deletion. */
function deleted(id: string): Promise<HostMessage> {
  return next(
    (message) =>
      isError(message) ||
      (message.type === "sidebar" &&
        !message.projects.some((project) => project.threads.some((thread) => thread.id === id))),
  );
}

function session(id: string, projectId: number, cwd = dir): string {
  const folder = path.join(dir, "sessions");
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${id}.jsonl`);
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", id, cwd, timestamp: new Date(1).toISOString() })}\n`,
  );
  store.addThread({ id, projectId, sessionFile: file, createdAt: 1 });
  return file;
}

/** A real ledger-owned linked checkout with its pi session stored outside it. */
async function managedSession() {
  const project = repository("managed-project", []);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, encoding: "utf8", stdio: "pipe" }).trim();
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, ".gitignore"), "ignored\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  const id = "managed-lifecycle";
  const checkout = path.join(dir, "worktrees", id);
  mkdirSync(path.dirname(checkout), { recursive: true });
  git("worktree", "add", "-b", "kept-branch", checkout);
  const { id: projectId } = store.addProject(project, 1);
  const file = session(id, projectId, checkout);
  store.addWorktree({
    root: null,
    path: checkout,
    repository: project,
    branch: "kept-branch",
    threadId: id,
  });
  const thread = await openThread(id);
  return { id, project, checkout, file, thread, git };
}

async function removeManagedThread(id: string, force = false): Promise<HostMessage> {
  const result = next((message) => message.type === "git-result");
  workspace.handle({
    v,
    type: "git-action",
    threadId: id,
    id: 1,
    expectedBranch: "kept-branch",
    action: { kind: "remove-worktree", force },
  });
  return result;
}

describe("worktree creation alongside a busy checkout", () => {
  it.each(["turn", "checkpoint"])(
    "creates a separate checkout during a background %s",
    async (busy) => {
      const { project, git } = await managedSession();
      const projectId = store.projects()[0]!.id;
      addThread(projectId, "working-local");
      const working = await openThread("working-local");
      if (busy === "turn") working.working = true;
      else vi.spyOn(working.checkpoints, "busy", "get").mockReturnValue(true);
      writeFileSync(path.join(project, "local.txt"), "Keep local changes");
      addThread(projectId, "new-local");
      await openThread("new-local");
      const created = next((message) => message.type === "git-result");
      workspace.handle({
        v,
        type: "git-action",
        threadId: "new-local",
        id: 1,
        expectedBranch: "main",
        action: { kind: "new-worktree", branch: "parallel", base: "main" },
      });
      expect(await created).toMatchObject({ error: null });
      const id = store.ui().openThread!;
      const checkout = store.worktrees().find((entry) => entry.threadId === id)!.path;
      expect(threads.find((thread) => thread.id === id)?.project).toBe(checkout);
      expect(existsSync(path.join(checkout, "local.txt"))).toBe(false);
      expect(readFileSync(path.join(project, "local.txt"), "utf8")).toBe("Keep local changes");
      expect(git("branch", "--show-current")).toBe("main");
      expect(working.close).not.toHaveBeenCalled();
      // Creating a checkout is safe; changing the busy checkout still isn't.
      await openThread("new-local");
      const refused = next((message) => message.type === "git-result");
      workspace.handle({
        v,
        type: "git-action",
        threadId: "new-local",
        id: 2,
        expectedBranch: "main",
        action: { kind: "create-branch", branch: "unsafe", base: "main" },
      });
      expect(await refused).toMatchObject({
        error: expect.stringContaining("pi is starting or working"),
      });
      expect(git("branch", "--show-current")).toBe("main");
    },
  );
});

describe("sidebar models", () => {
  it("reads unopened sessions without starting pi, including unknown models", async () => {
    const project = store.addProject(dir, 1);
    const file = session("saved-model", project.id);
    const header = readFileSync(file, "utf8");
    writeFileSync(
      file,
      `${header}${JSON.stringify({
        type: "model_change",
        provider: "custom",
        modelId: "saved-model",
      })}\n`,
    );
    session("unknown-model", project.id);
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: [
            { id: "saved-model", model: "custom/saved-model" },
            { id: "unknown-model", model: null },
          ],
        },
      ],
    });
    expect(threads).toHaveLength(0);
    expect(store.ui().openThread).toBeNull();
  });

  it("prefers live model changes, names saved models from the catalog and keeps a missing model unknown", async () => {
    const project = store.addProject(dir, 1);
    const file = session("saved", project.id);
    writeFileSync(
      file,
      `${readFileSync(file, "utf8")}${JSON.stringify({
        type: "model_change",
        provider: "faux",
        modelId: "faux-2",
      })}\n`,
    );
    addThread(project.id, "live");
    const thread = await openThread("live");
    const sessionState = {
      model: { provider: "faux", id: "faux-1" },
      models: [
        { provider: "faux", id: "faux-1", name: "Faux 1" },
        { provider: "faux", id: "faux-2", name: "Faux 2" },
      ],
      thinkingLevel: "off" as const,
      thinkingLevels: ["off" as const],
      context: null,
      commands: [],
      signedIn: true,
    };
    thread.status = { state: "ready", session: sessionState };
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: [
            { id: "live", model: "Faux 1" },
            { id: "saved", model: "Faux 2" },
          ],
        },
      ],
    });
    thread.status = {
      state: "ready",
      session: {
        ...sessionState,
        model: { provider: "faux", id: "faux-2" },
      },
    };
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: [
            { id: "live", model: "Faux 2" },
            { id: "saved", model: "Faux 2" },
          ],
        },
      ],
    });
    thread.status = { state: "ready", session: { ...sessionState, model: null } };
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [
        {
          threads: [
            { id: "live", model: null },
            { id: "saved", model: "Faux 2" },
          ],
        },
      ],
    });
    expect(threads).toHaveLength(1);
  });
});

describe("thread titles after compaction", () => {
  it("uses the original session prompt when pi's current context begins with a later prompt", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("compacted", projectId);
    const header = readFileSync(file, "utf8");
    writeFileSync(
      file,
      `${header}${JSON.stringify({ type: "message", message: { role: "user", content: "Original request" } })}\n`,
    );
    await workspace.refresh();
    const thread = await openThread("compacted");
    thread.state.messages = [{ role: "user", content: "Later request", timestamp: 2 }];
    thread.listener.reset();
    expect(sent.findLast((message) => message.type === "snapshot")).toMatchObject({
      thread: { title: "Original request" },
    });
    await workspace.refresh();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: [{ id: "compacted", title: "Original request" }] }],
    });
  });

  it("uses the live first prompt until the session has been indexed", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "fresh");
    const thread = await openThread("fresh");
    thread.state.messages = [{ role: "user", content: "First live request", timestamp: 1 }];
    thread.listener.reset();
    expect(sent.findLast((message) => message.type === "snapshot")).toMatchObject({
      thread: { title: "First live request" },
    });
    await workspace.refresh();
  });
});

describe("explicit worktree removal retains its session", () => {
  it.each([false, true])(
    "retains an addressable session after removal, with missing checkout %s",
    async (gone) => {
      const { id, project, checkout, file, thread, git } = await managedSession();
      store.setPinned(id, true);
      store.setDraft(id, "Keep the draft");
      store.setDraftImages(id, [IMAGE_FIXTURE]);
      store.saveCheckpoint(id, {
        turn: 1,
        startedAt: 1,
        state: "ready",
        reason: null,
        root: project,
        baseline: true,
      });
      if (gone) rmSync(checkout, { recursive: true });
      expect(await removeManagedThread(id)).toMatchObject({ type: "git-result", error: null });
      expect(thread.close).toHaveBeenCalledTimes(1);
      expect(existsSync(checkout)).toBe(false);
      expect(existsSync(file)).toBe(true);
      expect(store.worktrees()).toEqual([]);
      expect(store.thread(id)).toMatchObject({
        sessionFile: file,
        visible: true,
        pinned: true,
        draft: "Keep the draft",
      });
      expect(store.draftImages(id)).toEqual([IMAGE_FIXTURE]);
      expect(store.checkpoints(id)).toEqual([]);
      expect(git("branch", "--list", "kept-branch")).toContain("kept-branch");
      await workspace.refresh();
      expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
        projects: [{ threads: [{ id }] }],
      });
      const restarted = Store.open(path.join(dir, "tondo.db"));
      expect(restarted.thread(id)).toMatchObject({ sessionFile: file, visible: true });
      expect(restarted.worktrees()).toEqual([]);
      restarted.close();
    },
  );

  it("deletes the retained external session without removing its branch", async () => {
    const { id, checkout, file, git } = await managedSession();
    expect(await removeManagedThread(id)).toMatchObject({ error: null });
    await workspace.refresh();
    const removed = deleted(id);
    workspace.handle({ v, type: "delete-thread", threadId: id });
    expect((await removed).type).toBe("sidebar");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(checkout)).toBe(false);
    expect(store.thread(id)).toBeUndefined();
    expect(store.worktrees()).toEqual([]);
    expect(git("branch", "--list", "kept-branch")).toContain("kept-branch");
    const restarted = Store.open(path.join(dir, "tondo.db"));
    expect(restarted.thread(id)).toBeUndefined();
    restarted.close();
    expect(
      await new SessionIndex().list(checkout, { dir: path.dirname(file), shared: true }),
    ).toEqual([]);
  });

  it.each(["dirty", "ignored", "inside-session"])(
    "keeps refusal safeguards for %s files",
    async (kind) => {
      const { id, checkout, file, thread, git } = await managedSession();
      const protectedFile = path.join(checkout, kind === "ignored" ? "ignored" : "protected");
      writeFileSync(protectedFile, kind === "inside-session" ? readFileSync(file, "utf8") : "keep");
      if (kind === "inside-session") store.setSessionFile(id, protectedFile);
      const result = await removeManagedThread(id, kind === "inside-session");
      expect(result).toMatchObject({ type: "git-result", error: expect.any(String) });
      expect(thread.close).not.toHaveBeenCalled();
      expect(existsSync(checkout)).toBe(true);
      expect(existsSync(file)).toBe(true);
      expect(existsSync(protectedFile)).toBe(true);
      expect(store.worktrees()).toHaveLength(1);
      expect(store.thread(id)).toBeDefined();
      expect(git("branch", "--list", "kept-branch")).toContain("kept-branch");
    },
  );
});

describe("delete-thread", () => {
  it("closes idle pi and its terminal before deleting only the selected file and metadata", async () => {
    const close = vi.spyOn(Terminals.prototype, "close");
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("thread-a", projectId);
    const sibling = session("thread-b", projectId);
    store.setDraft("thread-a", "draft");
    store.setDraftImages("thread-a", [IMAGE_FIXTURE]);
    const thread = await openThread("thread-a");
    thread.close.mockImplementationOnce(async () => {
      expect(existsSync(file)).toBe(true);
    });
    const removed = deleted("thread-a");
    workspace.handle({ v, type: "delete-thread", threadId: "thread-a" });
    expect((await removed).type).toBe("sidebar");
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("thread-a");
    expect(thread.close).toHaveBeenCalledTimes(1);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(store.thread("thread-a")).toBeUndefined();
    expect(store.draftImages("thread-a")).toEqual([]);
    expect(store.ui().openThread).toBeNull();
    expect(
      await new SessionIndex().list(dir, { dir: path.dirname(file), shared: true }),
    ).toMatchObject([{ id: "thread-b" }]);
    const stale = next(isError);
    workspace.handle({ v, type: "open-thread", threadId: "thread-a" });
    expect((await stale).type).toBe("error");
    expect(threads.filter(({ id }) => id === "thread-a")).toHaveLength(1);
  });

  it("refuses busy pi including checkpoint work without closing or losing the session", async () => {
    const close = vi.spyOn(Terminals.prototype, "close");
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("busy", projectId);
    const thread = await openThread("busy");
    thread.working = true;
    const refused = next(isError);
    workspace.handle({ v, type: "delete-thread", threadId: "busy" });
    expect(await refused).toMatchObject({
      type: "error",
      message: expect.stringContaining("Stop pi first"),
    });
    expect(thread.close).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(true);
    expect(store.thread("busy")).toBeDefined();
  });

  it("refuses deletion while only checkpoint work is busy", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("checkpoint-busy", projectId);
    const thread = await openThread("checkpoint-busy");
    vi.spyOn(thread.checkpoints, "busy", "get").mockReturnValue(true);
    const refused = next(isError);
    workspace.handle({ v, type: "delete-thread", threadId: thread.id });
    expect((await refused).type).toBe("error");
    expect(thread.close).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(true);
  });

  it("guards reopening, drafts, prompts and terminals while closing pi", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("closing", projectId);
    const thread = await openThread("closing");
    const entered = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    thread.close.mockImplementationOnce(() => {
      entered.resolve();
      return closed.promise;
    });
    const removed = deleted("closing");
    workspace.handle({ v, type: "delete-thread", threadId: "closing" });
    await entered.promise;
    workspace.handle({ v, type: "open-thread", threadId: "closing" });
    workspace.handle({ v, type: "set-draft", threadId: "closing", text: "race" });
    workspace.handle({
      v,
      type: "prompt",
      threadId: "closing",
      text: "race",
      streamingBehavior: "steer",
    });
    workspace.handle({ v, type: "terminal-open", threadId: "closing", kind: "shell" });
    expect(thread.prompt).not.toHaveBeenCalled();
    expect(store.thread("closing")?.draft).toBe("");
    expect(existsSync(file)).toBe(true);
    closed.resolve();
    expect((await removed).type).toBe("sidebar");
    expect(store.thread("closing")).toBeUndefined();
  });

  it("keeps the row recoverable when unlink fails", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("failed", projectId);
    const folder = path.dirname(file);
    await openThread("failed");
    chmodSync(folder, 0o500);
    try {
      const failed = next(isError);
      workspace.handle({ v, type: "delete-thread", threadId: "failed" });
      expect(await failed).toMatchObject({
        type: "error",
        message: expect.stringContaining("EACCES"),
      });
    } finally {
      chmodSync(folder, 0o700);
    }
    expect(store.thread("failed")).toBeDefined();
    expect(existsSync(file)).toBe(true);
    await openThread("failed");
    expect(threads.filter(({ id }) => id === "failed")).toHaveLength(2);
  });

  it("deletes a discovered session without preexisting metadata and does not rediscover it", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("discovered", projectId);
    store.removeThread("discovered");
    const discovered = next(
      (message) =>
        message.type === "sidebar" &&
        message.projects.some((project) => project.threads.some(({ id }) => id === "discovered")),
    );
    workspace.handle({ v, type: "refresh" });
    await discovered;
    expect(store.thread("discovered")).toBeUndefined();
    const removed = deleted("discovered");
    workspace.handle({ v, type: "delete-thread", threadId: "discovered" });
    expect((await removed).type).toBe("sidebar");
    expect(existsSync(file)).toBe(false);
    expect(store.thread("discovered")).toBeUndefined();
    const index = new SessionIndex();
    expect(await index.list(dir, { dir: path.dirname(file), shared: true })).toEqual([]);
  });

  it("unlinks recorded copies in order and stops at the first failure", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const first = session("ordered", projectId);
    const blocked = path.join(dir, "blocked");
    mkdirSync(blocked);
    const second = path.join(blocked, "second.jsonl");
    const last = path.join(dir, "last.jsonl");
    const bytes = readFileSync(first, "utf8");
    writeFileSync(second, bytes);
    writeFileSync(last, bytes);
    vi.spyOn(SessionIndex.prototype, "files").mockReturnValue([first, second, last]);
    const unlink = vi.spyOn(SessionIndex.prototype, "delete");
    chmodSync(blocked, 0o500);
    try {
      const failed = next(isError);
      workspace.handle({ v, type: "delete-thread", threadId: "ordered" });
      expect(await failed).toMatchObject({
        type: "error",
        message: expect.stringContaining("EACCES"),
      });
    } finally {
      chmodSync(blocked, 0o700);
    }
    expect(unlink.mock.calls).toEqual([
      [first, "ordered"],
      [second, "ordered"],
    ]);
    expect(existsSync(first)).toBe(false);
    expect(readFileSync(second, "utf8")).toBe(bytes);
    expect(readFileSync(last, "utf8")).toBe(bytes);
    expect(store.thread("ordered")).toBeDefined();
  });

  it("removes only the selected thread's checkpoint refs and metadata", async () => {
    const checkout = repository("checkpoint-root", ["tracked"]);
    const { id: projectId } = store.addProject(checkout, 1);
    session("selected-checkpoints", projectId, checkout);
    session("sibling-checkpoints", projectId, checkout);
    await captureCheckpoint(checkout, "selected-checkpoints", 0);
    await captureCheckpoint(checkout, "sibling-checkpoints", 0);
    store.saveCheckpoint("selected-checkpoints", {
      turn: 1,
      startedAt: 1,
      state: "ready",
      reason: null,
      root: checkout,
      baseline: true,
    });
    const removed = deleted("selected-checkpoints");
    workspace.handle({ v, type: "delete-thread", threadId: "selected-checkpoints" });
    expect((await removed).type).toBe("sidebar");
    expect(store.checkpoints("selected-checkpoints")).toEqual([]);
    const refs = execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/tondo"], {
      cwd: checkout,
      encoding: "utf8",
    });
    expect(refs).not.toContain(
      `refs/tondo/checkpoints/${Buffer.from("selected-checkpoints").toString("base64url")}/`,
    );
    expect(refs).toContain(
      `refs/tondo/checkpoints/${Buffer.from("sibling-checkpoints").toString("base64url")}/`,
    );
  });

  it("deletes a legacy archived session with a missing checkout and missing file", async () => {
    const checkout = path.join(dir, "gone");
    const { id: projectId } = store.addProject(checkout, 1);
    store.addThread({
      id: "gone",
      projectId,
      sessionFile: path.join(dir, "missing.jsonl"),
      createdAt: 1,
    });
    store.setArchived("gone", true);
    workspace.greet();
    expect(sent.findLast((message) => message.type === "sidebar")).toMatchObject({
      projects: [{ threads: [{ id: "gone" }] }],
    });
    const removed = deleted("gone");
    workspace.handle({ v, type: "delete-thread", threadId: "gone" });
    expect((await removed).type).toBe("sidebar");
    expect(store.thread("gone")).toBeUndefined();
  });

  it("refuses a managed checkout without losing files or its ownership ledger", async () => {
    const { id: projectId } = store.addProject(dir, 1);
    const file = session("managed", projectId);
    const checkout = path.join(dir, "checkout");
    mkdirSync(checkout);
    writeFileSync(path.join(checkout, "untracked"), "keep");
    store.addWorktree({
      root: null,
      path: checkout,
      repository: dir,
      branch: "keep-branch",
      threadId: "managed",
    });
    const refused = next(isError);
    workspace.handle({ v, type: "delete-thread", threadId: "managed" });
    expect(await refused).toMatchObject({
      type: "error",
      message: expect.stringContaining("Remove this thread's managed worktree first"),
    });
    expect(readFileSync(path.join(checkout, "untracked"), "utf8")).toBe("keep");
    expect(store.worktrees()).toHaveLength(1);
    expect(existsSync(file)).toBe(true);
  });

  it("repairs a missing managed checkout before forgetting its owner", async () => {
    const missingRepository = path.join(dir, "gone-repository");
    const { id: projectId } = store.addProject(missingRepository, 1);
    const file = session("missing-managed", projectId, missingRepository);
    store.addWorktree({
      root: null,
      path: path.join(dir, "gone-checkout"),
      repository: missingRepository,
      branch: "kept",
      threadId: "missing-managed",
    });
    const removed = deleted("missing-managed");
    workspace.handle({ v, type: "delete-thread", threadId: "missing-managed" });
    expect((await removed).type).toBe("sidebar");
    expect(store.worktrees()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });
});

describe("marking threads unread", () => {
  beforeEach(() => {
    const { id: projectId } = store.addProject(dir, 1);
    addThread(projectId, "thread-a");
    addThread(projectId, "thread-b");
  });

  it.each(["thread-a", "thread-b"])(
    "marks %s unread without opening it, then clears the marker when opened",
    async (id) => {
      const current = await openThread("thread-a");
      const marked = next((message) => message.type === "sidebar");
      workspace.handle({ v, type: "mark-unread", threadId: id });
      expect(await marked).toMatchObject({
        projects: [
          { threads: expect.arrayContaining([expect.objectContaining({ id, unread: true })]) },
        ],
      });
      expect(store.ui().openThread).toBe("thread-a");
      expect(store.thread(id)?.unread).toBe(true);
      expect(threads).toHaveLength(1);

      sent.length = 0;
      const read = next((message) => message.type === "sidebar");
      workspace.handle({ v, type: "open-thread", threadId: id });
      expect(await read).toMatchObject({
        projects: [
          { threads: expect.arrayContaining([expect.objectContaining({ id, unread: false })]) },
        ],
      });
      expect(store.thread(id)?.unread).toBe(false);
      if (id === "thread-a") {
        expect(sent.some((message) => message.type === "snapshot")).toBe(false);
        expect(current.open).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("restores unread state at startup without treating the restored thread as explicitly opened", async () => {
    store.setUnread("thread-a", true);
    store.setUnread("thread-b", true);
    store.setUi("openThread", "thread-a");
    await workspace.start();
    expect(store.thread("thread-a")?.unread).toBe(true);
    expect(store.thread("thread-b")?.unread).toBe(true);
    const sidebar = sent.findLast((message) => message.type === "sidebar");
    expect(sidebar).toMatchObject({
      projects: [
        {
          threads: expect.arrayContaining([
            expect.objectContaining({ id: "thread-a", unread: true }),
            expect.objectContaining({ id: "thread-b", unread: true }),
          ]),
        },
      ],
    });
    expect(store.ui().openThread).toBe("thread-a");
    workspace.handle({ v, type: "open-thread", threadId: "thread-a" });
    expect(store.thread("thread-a")?.unread).toBe(false);
    expect(store.thread("thread-b")?.unread).toBe(true);
  });

  it("persists the automatic unread marker when a hidden turn finishes", async () => {
    const hidden = await openThread("thread-a");
    await openThread("thread-b");
    hidden.state.running = true;
    hidden.listener.changed();
    const marked = next(
      (message) =>
        message.type === "sidebar" &&
        message.projects.some((project) =>
          project.threads.some((thread) => thread.id === "thread-a" && thread.unread),
        ),
    );
    hidden.state.running = false;
    hidden.listener.changed();
    expect(store.thread("thread-a")?.unread).toBe(true);
    expect(store.thread("thread-b")?.unread).toBe(false);
    await marked;
  });

  it("rejects an unknown thread without starting pi", async () => {
    const error = next(isError);
    workspace.handle({ v, type: "mark-unread", threadId: "missing" });
    expect(await error).toMatchObject({ message: "Tondo has no thread missing." });
    expect(threads).toHaveLength(0);
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
