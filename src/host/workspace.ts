// Everything the sidebar lists and the threads Tondo runs. Projects are
// folders you add. Each lists the pi sessions it has, including ones you
// started in pi's own interface, merged with what Tondo's store remembers:
// threads too new for pi to have saved, and what you pinned or
// drafted. A thread runs a pi only while you use it, and the pool stops the
// ones you left.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Git } from "./git";
import { agentCheckout } from "./agentCheckout";
import { GitCommands } from "./gitCommand";
import { PiUpdatesService } from "./piUpdates";
import { inside, missing, Worktrees } from "./worktrees";
import {
  NO_EXTENSION_UI,
  PROTOCOL_VERSION,
  type Attention,
  type ClientMessage,
  type HostMessage,
  type NotifyLevel,
  type OpenThread,
  type SidebarProject,
  type SidebarThread,
  type ThreadActivity,
} from "../shared/protocol";
import { threadFromMessages } from "../shared/thread";
import { editorText } from "../shared/drafts";
import type { AppSettings, PaletteSetting, SettingsPatch, ThemeSetting } from "../shared/settings";
import { newShortcutProblems, type Settings } from "./settings";
import { FileIndexes } from "./fileIndex";
import { checkpointRoot, deleteCheckpoints } from "./checkpoints";
import { checkpointMetadata, TurnCheckpoints } from "./turnCheckpoints";
import type { DraftImage } from "../shared/images";
import { LiveThread, type ThreadListener } from "./liveThread";
import { PiExitError } from "./piProcess";
import { PiCommandError } from "./piRpc";
import { choosePiToStop, POOL_LIMITS, type PoolLimits } from "./pool";
import { messageTitle, SessionIndex, type SessionSummary } from "./sessionIndex";
import type { Store, StoredProject, StoredThread } from "./store";
import { TrustNotSavedError, type Supervisor } from "./supervisor";
import { canonical } from "./trust";
import { Terminals } from "./terminals";

const v = PROTOCOL_VERSION;

/** How long pi-driven sidebar changes wait, so a streaming thread resends the sidebar at most this often. */
const SIDEBAR_DELAY_MS = 100;

const NO_THREAD = threadFromMessages([]);

/** A session the index found, and the project that lists it. */
interface Found {
  readonly projectId: number;
  readonly summary: SessionSummary;
}

/** The most a notification's body says of a dialog's title. */
const NOTIFICATION_CHARS = 200;

export interface WorkspaceOptions {
  readonly userData: string;
  readonly gitGroups: (pgids: number[]) => void;
  readonly maintenanceGroups?: (pgids: number[]) => void;
  readonly store: Store;
  readonly supervisor: Supervisor;
  /** Pool limits that win over the settings, as TONDO_POOL sets for tests. */
  readonly poolOverride: Partial<PoolLimits>;
  /** Sends a message to the page, if one is connected. */
  readonly send: (message: HostMessage) => void;
  /** Asks main to show the folder dialog for a project or the worktree setting. */
  readonly chooseFolder: (purpose: "project" | "worktree") => void;
  /** Asks main to show the file dialog for pi. Main answers through piChosen. */
  readonly choosePi: () => void;
  readonly chooseFiles: (id: string) => void;
  /** Tells main the theme the settings ask for. */
  readonly setTheme: (theme: ThemeSetting, palette: PaletteSetting) => void;
  /** Asks main to raise a notification about a thread. */
  readonly attention: (attention: Attention) => void;
  /** Asks main to put text on the clipboard. */
  readonly copy: (text: string) => void;
  /** Asks main to show a file in Finder. */
  readonly reveal: (file: string) => void;
  readonly terminalGroups: (pgids: number[]) => void;
}

export class Workspace {
  private readonly store: Store;
  private readonly supervisor: Supervisor;
  private readonly poolOverride: Partial<PoolLimits>;
  private limits: PoolLimits;
  private readonly send: (message: HostMessage) => void;
  private readonly chooseFolder: WorkspaceOptions["chooseFolder"];
  private readonly choosePi: () => void;
  private readonly chooseFiles: (id: string) => void;
  private readonly setTheme: (theme: ThemeSetting, palette: PaletteSetting) => void;
  /** The theme main last heard, which an outside edit to settings.json doesn't change. */
  private theme: ThemeSetting | null = null;
  private palette: PaletteSetting | null = null;
  /** The problem with settings.json Tondo last told you about as it started a pi. */
  private settingsProblem: string | null = null;
  private choosingPi = false;
  private choosingWorktreeDirectory = false;
  private readonly attention: (attention: Attention) => void;
  private readonly copy: (text: string) => void;
  private readonly reveal: (file: string) => void;
  /** Files the page may ask main to show in Finder: the ones Tondo offered it. */
  private readonly offered = new Set<string>();
  private readonly index = new SessionIndex();
  private readonly files = new FileIndexes();
  /** The draft an extension last set in each thread that wasn't on screen. */
  private readonly extensionDrafts = new Map<string, string>();
  private readonly terminals: Terminals;
  private readonly git: Git;
  private readonly piUpdates: PiUpdatesService;
  private piUpdating = false;
  private readonly worktrees: Worktrees;
  private gitTimer: NodeJS.Timeout | undefined;
  private gitGeneration = 0;
  private gitConnected = false;
  private gitMutation = false;
  private gitReading: Promise<void> = Promise.resolve();
  private lastGit = "";
  /** Sessions in the projects' session folders, by id. */
  private found = new Map<string, Found>();
  /** The threads whose pi is running, starting, asking about trust or exited. */
  private readonly live = new Map<string, LiveThread>();
  /** What each live thread was last doing, to notice when a thread you aren't looking at finishes. */
  private readonly activities = new Map<string, ThreadActivity>();
  /** Threads that finished or failed while you looked at another. */
  private readonly unread = new Set<string>();
  private visibleId: string | null = null;
  private choosing = false;
  private readonly removingProjects = new Set<number>();
  private readonly forgettingThreads = new Set<string>();
  private readonly deletingThreads = new Set<string>();
  private readonly closingThreads = new Map<string, Promise<void>>();
  private indexing: Promise<void> = Promise.resolve();
  private refreshQueued = false;
  private sidebarTimer: NodeJS.Timeout | undefined;
  private lastSidebar = "";
  private poolTimer: NodeJS.Timeout | undefined;

  constructor(options: WorkspaceOptions) {
    this.store = options.store;
    this.supervisor = options.supervisor;
    this.poolOverride = options.poolOverride;
    this.limits = { ...POOL_LIMITS, ...options.poolOverride };
    this.send = options.send;
    this.chooseFolder = options.chooseFolder;
    this.choosePi = options.choosePi;
    this.chooseFiles = options.chooseFiles;
    this.setTheme = options.setTheme;
    this.attention = options.attention;
    this.copy = options.copy;
    this.reveal = options.reveal;
    this.git = new Git(new GitCommands(() => this.supervisor.captureLoginEnv(), options.gitGroups));
    this.piUpdates = new PiUpdatesService(
      (updates) => this.send({ v, type: "pi-updates", updates }),
      options.maintenanceGroups ?? (() => {}),
    );
    this.worktrees = new Worktrees(path.join(options.userData, "worktrees"), this.store, this.git);
    this.terminals = new Terminals(
      async (threadId, kind) => {
        const row = this.row(threadId);
        const cwd = this.checkout(row);
        if (this.gitMutation) throw new Error("Wait for the Git action before opening a terminal.");
        if (await this.supervisor.needsTrustAnswer(cwd))
          throw new Error("Answer the project's trust question before opening its terminal.");
        return this.supervisor.terminalLaunch(cwd, kind);
      },
      this.send,
      options.terminalGroups,
      (threadId, kind) => {
        if (kind === "login") this.signedInOrOut(threadId);
      },
    );
  }

  /**
   * Applies the saved settings' pool limits and theme. The host calls it once
   * as it starts, before any page connects.
   */
  applySettings(): void {
    const { settings, problem } = this.supervisor.readableSettings();
    if (problem !== null) {
      console.error(`Tondo Host uses the defaults for what it can't read: ${problem}`);
    }
    this.setLimits(this.poolLimits(settings));
    this.applyTheme(settings.theme, settings.palette);
  }

  /** Tells main the theme, unless main has it already. */
  private applyTheme(theme: ThemeSetting, palette: PaletteSetting): void {
    if (theme === this.theme && palette === this.palette) return;
    this.theme = theme;
    this.palette = palette;
    this.setTheme(theme, palette);
  }

  /** Changes the pool's limits, and stops the pi processes they no longer allow. */
  setLimits(limits: PoolLimits): void {
    this.limits = limits;
    this.checkPool();
  }

  /** The file you picked in the pi dialog, or null if you cancelled. */
  piChosen(file: string | null): void {
    this.choosingPi = false;
    if (file !== null) this.run(() => this.setSettings({ piPath: file }));
  }

  /** The folder picked for new worktrees, or null if the dialog was cancelled. */
  worktreeDirectoryChosen(folder: string | null): void {
    this.choosingWorktreeDirectory = false;
    if (folder !== null) this.run(() => this.setSettings({ worktreeDirectory: folder }));
  }

  disconnected(): void {
    this.gitConnected = false;
    this.gitGeneration++;
    clearTimeout(this.gitTimer);
    this.terminals.detachAll();
  }

  closeTerminals(): Promise<void> {
    return this.terminals.closeAll();
  }

  /** You clicked a notification about the thread. */
  openThread(threadId: string): void {
    if (this.gitMutation || this.piUpdating) return;
    this.run(() => this.open(threadId));
  }

  /** Reopens the thread you had open, then reads every project's sessions. */
  async start(): Promise<void> {
    await this.worktrees.cleanup((message) => this.toast("warning", message));
    const { openThread } = this.store.ui();
    if (openThread !== null && this.store.thread(openThread)) this.run(() => this.open(openThread));
    await this.refresh();
    this.run(() => this.forgetUnused());
  }

  /** Sends a new page everything it shows. */
  greet(): void {
    this.send({ v, type: "ui", sidebarHidden: this.store.ui().sidebarHidden });
    this.sendSettings(null);
    this.piUpdates.report();
    this.run(() => this.sendPiEnv());
    this.sendSnapshot();
    this.lastSidebar = "";
    this.sendSidebar();
    this.terminals.greet();
    this.gitConnected = true;
    this.refreshGit();
  }

  handle(message: ClientMessage): void {
    if (
      this.piUpdating &&
      ![
        "ping",
        "stop",
        "set-draft",
        "set-draft-images",
        "choose-files",
        "set-sidebar-hidden",
        "prompt",
        "list-files",
        "list-checkpoints",
        "find-files",
        "get-pi-config-files",
        "get-pi-accounts",
        "get-project-git",
        "reveal",
        "check-pi-updates",
        "apply-pi-update",
      ].includes(message.type)
    ) {
      const error =
        "Wait for the pi update to finish before changing threads, settings or Git state.";
      if (message.type === "git-action")
        this.send({ v, type: "git-result", threadId: message.threadId, id: message.id, error });
      else if (message.type === "read-checkpoint")
        this.send({
          v,
          type: "checkpoint-diff",
          threadId: message.threadId,
          id: message.id,
          turn: message.turn,
          diff: { files: [], error },
        });
      else this.send({ v, type: "error", message: error });
      return;
    }
    if (
      "threadId" in message &&
      message.threadId !== null &&
      this.deletingThreads.has(message.threadId)
    ) {
      this.toast("warning", "This thread is being deleted. Wait for deletion to finish.");
      return;
    }
    // No new pi or extension work may race checkout changes. Existing turns are checked below.
    if (
      this.gitMutation &&
      [
        "new-thread",
        "open-thread",
        "restart",
        "trust",
        "rename-thread",
        "compact",
        "reload",
        "remove-project",
        "delete-thread",
      ].includes(message.type)
    ) {
      this.toast("warning", "Wait for the Git action to finish.");
      return;
    }
    switch (message.type) {
      case "git-refresh":
        if (message.threadId === this.visibleId) this.refreshGit(true);
        break;
      case "git-action":
        void this.gitAction(message);
        break;
      case "terminal-open":
      case "terminal-close":
      case "terminal-attach":
      case "terminal-detach":
      case "terminal-write":
      case "terminal-resize":
      case "terminal-ack":
        this.run(() => this.terminals.handle(message));
        break;
      case "add-project":
        if (!this.choosing) {
          this.choosing = true;
          this.chooseFolder("project");
        }
        break;
      case "remove-project":
        this.run(() => this.removeProject(message.projectId));
        break;
      case "set-collapsed":
        this.run(() => {
          this.project(message.projectId);
          this.store.setCollapsed(message.projectId, message.collapsed);
          this.sendSidebar();
        });
        break;
      case "new-thread":
        this.run(() => this.newThread(message.projectId));
        break;
      case "open-thread":
        this.run(() => this.open(message.threadId));
        break;
      case "rename-thread":
        this.run(async () => {
          const thread = this.live.get(message.threadId) ?? this.startThread(message.threadId);
          await thread.rename(message.name.trim());
        });
        break;
      case "pin-thread":
        this.run(() => {
          this.row(message.threadId);
          this.store.setPinned(message.threadId, message.pinned);
          this.sendSidebar();
        });
        break;
      case "delete-thread":
        this.run(() => this.deleteThread(message.threadId));
        break;
      case "choose-files":
        this.chooseFiles(message.id);
        break;
      case "set-draft":
        this.run(() => this.setDraft(message.threadId, message.text, message.userInput));
        break;
      case "set-draft-images":
        this.run(() => {
          this.row(message.threadId);
          this.store.setDraftImages(message.threadId, message.images);
          this.sendSidebar();
        });
        break;
      case "list-checkpoints":
        this.run(() => {
          const thread = this.live.get(message.threadId);
          if (thread) return this.sendCheckpoints(thread);
          // The header can request metadata while maintenance has stopped its pi.
          this.row(message.threadId);
          const turns = this.store.checkpoints(message.threadId).map(checkpointMetadata);
          this.send({
            v,
            type: "checkpoints",
            threadId: message.threadId,
            turns,
            shared: false,
            unavailable: "pi is stopped. Turn diffs resume when you reopen the thread.",
          });
        });
        break;
      case "read-checkpoint":
        this.run(async () => {
          const diff = await this.running(message.threadId).checkpoints.diff(message.turn);
          this.send({
            v,
            type: "checkpoint-diff",
            threadId: message.threadId,
            id: message.id,
            turn: message.turn,
            diff,
          });
        });
        break;
      case "list-files":
        this.run(async () => {
          const row = this.row(message.threadId);
          const index = await this.files.read(this.checkout(row));
          this.send({ v, type: "files", threadId: message.threadId, id: message.id, index });
        });
        break;
      case "find-files":
        this.run(async () => {
          const row = this.row(message.threadId);
          const paths = await this.files.find(this.checkout(row), message.query);
          const { threadId, id, query } = message;
          this.send({ v, type: "file-matches", threadId, id, query, paths });
        });
        break;
      case "set-sidebar-hidden":
        this.run(() => this.store.setUi("sidebarHidden", message.hidden));
        break;
      case "refresh":
        this.run(() => this.refresh());
        break;
      case "trust":
        this.run(async () => {
          try {
            await this.running(message.threadId).trust(message.trusted);
          } catch (error) {
            if (!(error instanceof TrustNotSavedError)) throw error;
            // A toast shows over the trust question too, which stays up so you can answer again.
            this.offered.add(error.file);
            this.toast("error", error.message, error.file);
          }
        });
        break;
      case "prompt":
        this.run(() => this.prompt(message));
        break;
      case "stop":
        this.run(() => this.running(message.threadId).stop());
        break;
      case "dequeue":
        this.run(() => this.running(message.threadId).dequeue());
        break;
      case "set-model":
        this.run(() => this.running(message.threadId).setModel(message.provider, message.modelId));
        break;
      case "set-thinking-level":
        this.run(() => this.running(message.threadId).setThinkingLevel(message.level));
        break;
      case "restart":
        this.run(() => this.running(message.threadId).restart());
        break;
      case "answer":
        this.run(() => this.running(message.threadId).answer(message.dialogId, message.answer));
        break;
      case "compact":
        this.run(async () => {
          const thread = this.running(message.threadId);
          const compacted = await thread.compact(message.instructions).catch((error: unknown) => {
            // pi reports a failed compaction in its compaction_end event too, and the thread shows that.
            if (error instanceof PiCommandError) return null;
            throw error;
          });
          if (!compacted) return;
          const { tokensBefore, estimatedTokensAfter } = compacted;
          const before = tokensBefore.toLocaleString("en");
          // An extension that compacts in its own way may leave the estimate out.
          const after =
            estimatedTokensAfter === undefined
              ? ""
              : ` to about ${estimatedTokensAfter.toLocaleString("en")}`;
          this.toast("info", `Compacted the context from ${before}${after} tokens.`);
        });
        break;
      case "copy-reply":
        this.run(async () => {
          const text = await this.running(message.threadId).lastReply();
          if (text === null) {
            this.toast("info", "pi hasn't replied in this thread yet.");
            return;
          }
          this.copy(text);
          this.toast("info", "Copied pi's last reply.");
        });
        break;
      case "export":
        this.run(() => this.exportThread(message.threadId, message.path));
        break;
      case "session-info":
        this.run(async () => {
          const info = await this.running(message.threadId).sessionInfo();
          if (info.file) this.offered.add(info.file);
          const sheet = { kind: "session", info } as const;
          this.send({ v, type: "sheet", threadId: message.threadId, sheet });
        });
        break;
      case "trust-status":
        this.run(async () => {
          const thread = this.running(message.threadId);
          const trust = await thread.trustInfo();
          const sheet = { kind: "trust", project: thread.project, trust } as const;
          this.send({ v, type: "sheet", threadId: message.threadId, sheet });
        });
        break;
      case "reload":
        this.run(() => this.running(message.threadId).reload());
        break;
      case "reveal":
        this.run(() => {
          if (!this.offered.has(message.path)) {
            throw new Error("Tondo shows only files it offered in Finder.");
          }
          this.reveal(message.path);
        });
        break;
      case "ping":
        this.send({ v, type: "pong", id: message.id });
        break;
      case "set-settings":
        this.run(() => this.setSettings(message.patch));
        break;
      case "choose-worktree-directory":
        if (!this.choosingWorktreeDirectory) {
          this.choosingWorktreeDirectory = true;
          this.chooseFolder("worktree");
        }
        break;
      case "choose-pi-path":
        if (!this.choosingPi) {
          this.choosingPi = true;
          this.choosePi();
        }
        break;
      case "retry-pi":
        this.run(() => this.rediscoverPi());
        break;
      case "get-pi-config-files":
        this.run(async () => {
          const { threadId } = message;
          const cwd = threadId === null ? null : this.checkout(this.row(threadId));
          const files = await this.supervisor.settingsFiles(cwd);
          for (const file of files) if (file.exists) this.offered.add(file.path);
          this.send({ v, type: "pi-config-files", files });
        });
        break;
      case "check-pi-updates":
        if (this.piUpdating) {
          this.piUpdates.report();
          break;
        }
        this.run(async () => {
          const cwd =
            message.manual && this.visibleId ? this.checkout(this.row(this.visibleId)) : null;
          try {
            await this.piUpdates.check(
              await this.supervisor.maintenanceContext(cwd),
              message.manual,
            );
          } catch (error) {
            this.piUpdates.failed(error);
          }
        });
        break;
      case "apply-pi-update":
        this.run(() => this.applyPiUpdate(message.id));
        break;
      case "get-pi-accounts":
        this.run(async () => {
          const { accounts, error } = await this.supervisor.piAccounts();
          this.send({ v, type: "pi-accounts", accounts, error });
        });
        break;
      case "get-project-git":
        this.run(async () => {
          const { projectId } = message;
          // Home can queue a read before the removal's sidebar update arrives.
          // Discard it during removal and after the project has been forgotten.
          const project = this.store.projects().find((candidate) => candidate.id === projectId);
          if (!project || this.removingProjects.has(projectId)) return;
          const status = await this.git.status(project.path, false);
          const git = status.root !== null;
          this.send({ v, type: "project-git", projectId, git, branch: status.branch });
        });
        break;
    }
  }

  /**
   * Saves a settings change if it's valid, and applies it at once. Either way
   * the page gets the settings, with the reason if they didn't change.
   */
  private async setSettings(patch: SettingsPatch): Promise<void> {
    if (this.piUpdating) throw new Error("Wait for the pi update before changing settings.");
    let before: Settings;
    let after: Settings;
    try {
      before = this.supervisor.settings();
      if (patch.shortcuts !== undefined) {
        const problems = newShortcutProblems(before.shortcuts, patch.shortcuts);
        if (problems.length > 0) throw new Error(problems.join(" "));
      }
      if (typeof patch.piPath === "string") await this.supervisor.checkPi(patch.piPath);
      after = this.supervisor.updateSettings(patch);
    } catch (error) {
      this.sendSettings(messageOf(error));
      return;
    }
    this.sendSettings(null);
    this.setLimits(this.poolLimits(after));
    // settings.json may have changed outside Tondo since main last heard the theme.
    this.applyTheme(after.theme, after.palette);
    if (after.piPath !== before.piPath) await this.rediscoverPi();
  }

  /**
   * Sends the page the settings Tondo uses, with defaults for what the file
   * gets wrong, why a change was refused (`error`) and, apart from that,
   * what's wrong with the file.
   */
  private sendSettings(error: string | null): void {
    const { settings, problem } = this.supervisor.readableSettings();
    // The page may offer to show a broken file in Finder.
    if (problem !== null) this.offered.add(this.supervisor.settingsFile);
    const {
      piPath,
      worktreeDirectory,
      theme,
      palette,
      expandThinking,
      pool,
      panelWidths,
      shortcuts,
    } = settings;
    this.send({
      v,
      type: "settings",
      // The page applies the same saved palette that main receives for its window.
      settings: {
        piPath,
        worktreeDirectory,
        theme,
        palette,
        expandThinking,
        pool,
        panelWidths,
        shortcuts,
      },
      error,
      fileProblem:
        problem === null ? null : { path: this.supervisor.settingsFile, message: problem },
    });
  }

  /**
   * Tells you, once for each problem, that pi starts with defaults for what
   * settings.json gets wrong, and offers to show the file.
   */
  private noteSettingsProblem(): void {
    const { problem } = this.supervisor.readableSettings();
    if (problem === this.settingsProblem) return;
    this.settingsProblem = problem;
    if (problem === null) return;
    const file = this.supervisor.settingsFile;
    this.offered.add(file);
    this.toast("warning", `${problem}. Tondo uses the defaults for what it can't read.`, file);
  }

  private async sendPiEnv(): Promise<void> {
    this.send({ v, type: "pi-env", pi: await this.supervisor.discover() });
  }

  /** Looks for pi again, and starts again every thread whose pi Tondo couldn't find. */
  private async rediscoverPi(): Promise<void> {
    await this.sendPiEnv();
    for (const thread of this.live.values()) {
      const { status } = thread;
      if (status.state === "exited" && status.problem) this.run(() => thread.restart());
    }
  }

  /** The login terminal closed, so a ready pi reloads to read the credentials it left. */
  private signedInOrOut(threadId: string): void {
    const thread = this.live.get(threadId);
    if (thread?.status.state === "ready" && !thread.busy) this.run(() => thread.reload());
  }

  /** The defaults, then the settings, then the override from the environment. */
  private poolLimits({ pool }: AppSettings): PoolLimits {
    return { maxLive: pool.maxLive, idleMs: pool.idleMinutes * 60_000, ...this.poolOverride };
  }

  /** The folder you picked in the dialog, or null if you cancelled. It opens a new thread there. */
  projectChosen(folder: string | null): void {
    this.choosing = false;
    if (folder === null) return;
    if (this.gitMutation || this.piUpdating) {
      this.toast(
        "warning",
        "Wait for the current Git or pi update operation, then add the project again.",
      );
      return;
    }
    this.run(async () => {
      const project = this.store.addProject(canonical(folder), Date.now());
      this.newThread(project.id);
      await this.enqueueIndex([project]);
    });
  }

  /** Reads every project's session folder again, to find sessions pi wrote outside Tondo. */
  refresh(): Promise<void> {
    if (this.refreshQueued) return this.indexing;
    this.refreshQueued = true;
    return this.enqueueIndex(() => {
      this.refreshQueued = false;
      return this.store.projects();
    });
  }

  private enqueueIndex(
    projects: readonly StoredProject[] | (() => readonly StoredProject[]),
  ): Promise<void> {
    this.indexing = this.indexing
      .then(() => this.indexProjects(typeof projects === "function" ? projects() : projects))
      .catch((error: unknown) => this.report(error));
    return this.indexing;
  }

  private async indexProjects(projects: readonly StoredProject[]): Promise<void> {
    const results = await Promise.allSettled(
      projects.map(async (project) => {
        const paths = new Set([
          project.path,
          ...this.store
            .threads()
            .filter((row) => row.projectId === project.id)
            .map((row) => this.checkout(row)),
        ]);
        const sessions = await Promise.all(
          [...paths].map(async (cwd) => {
            const folder = await this.supervisor.sessionFolder(cwd);
            const summaries = await this.index.list(cwd, folder);
            if (cwd === project.path) return summaries;
            // A managed checkout belongs to one thread. Do not reopen unrelated
            // sessions found there in the project's local checkout.
            return summaries.filter(
              (session) => this.worktrees.forThread(session.id)?.path === cwd,
            );
          }),
        );
        return sessions.flat();
      }),
    );
    const found = new Map(this.found);
    const listed = new Set<number>();
    for (const [i, result] of results.entries()) {
      const project = projects[i]!;
      if (result.status === "rejected") {
        this.report(result.reason);
        continue;
      }
      for (const [id, entry] of found) {
        if (entry.projectId === project.id) found.delete(id);
      }
      for (const summary of result.value) {
        if (!this.deletingThreads.has(summary.id))
          found.set(summary.id, { projectId: project.id, summary });
      }
      listed.add(project.id);
    }
    // A thread's file can be outside the folder, such as after you change pi's sessionDir.
    const outside = this.store
      .threads()
      .filter((row) => listed.has(row.projectId) && row.sessionFile !== null && !found.has(row.id));
    const summaries = await Promise.all(outside.map((row) => this.index.summary(row.sessionFile!)));
    outside.forEach((row, i) => {
      const summary = summaries[i];
      if (summary && !this.deletingThreads.has(row.id))
        found.set(row.id, { projectId: row.projectId, summary });
    });
    this.found = found;
    this.sendSidebar();
  }

  /** /export. pi's RPC exports HTML only, so a .jsonl path gets the session file pi already keeps. */
  private async exportThread(threadId: string, outputPath: string): Promise<void> {
    const thread = this.running(threadId);
    if (/\.jsonl$/i.test(outputPath)) {
      const file = thread.sessionFile;
      if (file === null || !existsSync(file)) {
        this.toast("info", "Tondo exports HTML only, and pi hasn't saved this thread yet.");
        return;
      }
      this.offered.add(file);
      this.toast("info", `Tondo exports HTML only. pi keeps the thread as JSONL in ${file}.`, file);
      return;
    }
    const file = await thread.exportHtml(outputPath);
    this.offered.add(file);
    this.toast("info", `Saved the thread to ${file}.`, file);
  }

  /** Shows a toast about the thread on screen. */
  private toast(level: NotifyLevel, message: string, reveal?: string): void {
    this.send({ v, type: "toast", level, message, ...(reveal === undefined ? {} : { reveal }) });
  }

  private newThread(projectId: number): void {
    this.project(projectId);
    const id = randomUUID();
    this.store.addThread({ id, projectId, sessionFile: null, createdAt: Date.now() }, false);
    this.open(id);
  }

  /** Puts a thread on screen, starting its pi if it isn't running. */
  private open(id: string): void {
    if (id === this.visibleId && this.live.has(id)) return;
    // Capture this before startThread registers a replacement for the visible pi.
    // Otherwise reopening that same thread mistakes its replacement for one we left.
    const previous = this.visibleThread();
    const existing = this.live.get(id);
    const thread = existing ?? this.startThread(id);
    // You may have answered for the project in another thread since.
    if (existing?.askingTrust) this.run(() => existing.open());
    if (previous) {
      previous.hide();
      previous.lastUsed = Date.now();
    }
    this.terminals.detachAll();
    this.visibleId = id;
    this.unread.delete(id);
    thread.show();
    thread.lastUsed = Date.now();
    this.store.setUi("openThread", id);
    this.sendSnapshot();
    this.refreshGit();
    if (previous) this.run(() => this.forgetIfUnused(previous.id));
    this.sendSidebar();
    this.checkPool();
  }

  /** Starts a thread's pi, off screen until you open it. */
  private startThread(id: string): LiveThread {
    if (this.piUpdating) throw new Error("Wait for the pi update before starting a thread.");
    const row = this.row(id);
    const project = this.project(row.projectId);
    const cwd = this.checkout(row);
    const thread: LiveThread = new LiveThread(
      { id: project.id, path: cwd },
      { id, file: row.sessionFile },
      this.supervisor,
      this.listen(() => thread),
      new TurnCheckpoints(this.store, id, cwd, () => {
        const current = this.live.get(id);
        if (current?.visible) this.run(() => this.sendCheckpoints(current));
        this.checkPool();
      }),
    );
    this.live.set(id, thread);
    this.noteSettingsProblem();
    this.run(() => thread.open());
    return thread;
  }

  private async sendCheckpoints(thread: LiveThread): Promise<void> {
    let unavailable: string | null = null;
    try {
      if (!(await checkpointRoot(thread.project)))
        unavailable = "This folder is not a Git checkout. Turn diffs need Git.";
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
    }
    const shared = [...this.live.values()].some(
      (other) => other.id !== thread.id && other.project === thread.project,
    );
    const turns = await thread.checkpoints.list();
    this.send({
      v,
      type: "checkpoints",
      threadId: thread.id,
      turns,
      shared,
      unavailable,
    });
  }

  private listen(self: () => LiveThread): ThreadListener {
    /** The thread, or undefined if the workspace let go of it. */
    const current = () => {
      const thread = self();
      return this.live.get(thread.id) === thread ? thread : undefined;
    };
    return {
      events: (events) => {
        const thread = current();
        if (thread?.visible) {
          this.send({ v, type: "events", threadId: thread.id, events });
          if (
            events.some(
              (event) =>
                event.type === "tool_execution_start" || event.type === "tool_execution_end",
            )
          )
            this.refreshGit();
        }
      },
      reset: () => {
        const thread = current();
        if (!thread) return;
        const file = thread.sessionFile;
        if (file !== null && file !== this.store.thread(thread.id)?.sessionFile) {
          this.store.setSessionFile(thread.id, file);
        }
        this.noteActivity(thread);
        if (thread.visible) this.sendSnapshot();
        this.scheduleSidebar();
        this.checkPool();
      },
      changed: () => {
        const thread = current();
        if (!thread) return;
        this.noteActivity(thread);
        if (thread.visible) this.send({ v, type: "status", thread: this.describe(thread) });
        this.scheduleSidebar();
        this.checkPool();
      },
      restore: (text) => {
        const thread = current();
        if (!thread) return;
        this.restoreDraft(thread.id, text);
      },
      error: (message) => {
        const thread = current();
        if (!thread) return;
        const where = thread.visible ? "" : `${this.titleOf(thread.id)}: `;
        this.send({ v, type: "error", message: `${where}${message}` });
      },
      uiChanged: (dialogs) => {
        const thread = current();
        if (!thread) return;
        if (thread.visible)
          this.send({ v, type: "extension-ui", threadId: thread.id, ui: thread.ui });
        if (!dialogs) return;
        // A dialog makes the thread wait for you, which the sidebar shows and the pool respects.
        this.noteActivity(thread);
        this.scheduleSidebar();
        this.checkPool();
      },
      asked: (dialog) => {
        const thread = current();
        if (!thread) return;
        const body = dialog.title.replaceAll(/\s+/g, " ").trim();
        this.attention({
          threadId: thread.id,
          visible: thread.visible,
          title: this.titleOf(thread.id),
          body: body.length > NOTIFICATION_CHARS ? `${body.slice(0, NOTIFICATION_CHARS)}…` : body,
        });
      },
      notified: (level, message) => {
        const thread = current();
        if (!thread) return;
        const from = thread.visible ? {} : { thread: this.titleOf(thread.id) };
        this.send({ v, type: "toast", level, message, ...from });
      },
      editorText: (text) => {
        const thread = current();
        if (!thread) return;
        if (thread.visible) this.send({ v, type: "editor-text", threadId: thread.id, text });
        // A thread that isn't on screen keeps the text in its draft, after what you typed.
        else {
          const draft = editorText(
            this.row(thread.id).draft,
            text,
            this.extensionDrafts.get(thread.id),
          );
          this.extensionDrafts.set(thread.id, text);
          this.setDraft(thread.id, draft, false);
        }
      },
    };
  }

  /** Marks a thread unread when pi finishes or fails in it while you look at another. */
  private noteActivity(thread: LiveThread): void {
    const activity = activityOf(thread);
    const before = this.activities.get(thread.id);
    this.activities.set(thread.id, activity);
    if (!thread.visible && isBusy(before) && !isBusy(activity)) this.unread.add(thread.id);
  }

  private restoreDraft(id: string, text: string): void {
    if (id === this.visibleId) {
      this.send({ v, type: "restore", threadId: id, text });
    } else {
      const row = this.store.thread(id);
      if (row) this.setDraft(id, [text, row.draft].filter(Boolean).join("\n\n"));
    }
  }

  /** Keep image drafts until pi acknowledges the prompt, including across a host crash. */
  private async prompt(message: Extract<ClientMessage, { type: "prompt" }>): Promise<void> {
    const { threadId, text, streamingBehavior, imageIds = [] } = message;
    let sent = false;
    try {
      let thread: LiveThread;
      let images: DraftImage[];
      try {
        if (this.piUpdating) throw new Error("Wait for the pi update before sending a prompt.");
        thread = this.running(threadId);
        if (this.gitMutation) throw new Error("Wait for the Git action before sending a prompt.");
        images =
          imageIds.length === 0
            ? []
            : this.store.draftImages(threadId).filter((image) => imageIds.includes(image.id));
        if (images.length !== imageIds.length)
          throw new Error("Some attached images are no longer in this draft. Attach them again.");
      } catch (error) {
        this.restoreDraft(threadId, text);
        throw error;
      }
      await thread.prompt(text, streamingBehavior, images);
      // Sending an extension's suggestion is user input too, without an editor edit.
      if (text.trim() !== "" || images.length > 0) {
        this.store.revealThread(threadId);
        this.sendSidebar();
      }
      if (imageIds.length > 0) {
        this.store.setDraftImages(
          threadId,
          this.store.draftImages(threadId).filter((image) => !imageIds.includes(image.id)),
        );
        this.scheduleSidebar();
      }
      sent = true;
    } finally {
      if (imageIds.length > 0) this.send({ v, type: "image-send-ended", threadId, imageIds, sent });
    }
  }

  private setDraft(id: string, text: string, userInput = true): void {
    this.row(id);
    this.store.setDraft(id, text, userInput);
    this.sendSidebar();
  }

  /** Every tool for a worktree thread uses its checkout, not the sidebar project's folder. */
  private checkout(row: StoredThread): string {
    return this.worktrees.forThread(row.id)?.path ?? this.project(row.projectId).path;
  }

  private refreshGit(fresh = false): void {
    clearTimeout(this.gitTimer);
    const generation = ++this.gitGeneration;
    this.lastGit = "";
    if (!this.gitConnected || this.gitMutation || this.visibleId === null) return;
    const id = this.visibleId;
    this.gitReading = this.gitReading.then(() => this.pollGit(id, generation, fresh));
  }

  private async pollGit(id: string, generation: number, fresh: boolean): Promise<void> {
    if (generation !== this.gitGeneration || this.gitMutation) return;
    let status = null;
    let error = null;
    let activity = null;
    try {
      const cwd = this.checkout(this.row(id));
      status = await this.git.status(cwd, true, fresh);
      const thread = this.live.get(id);
      if (status.root && thread)
        activity = await agentCheckout(this.git, cwd, status.root, thread.state);
    } catch (cause) {
      const worktree = this.worktrees.forThread(id);
      error =
        worktree && (await missing(worktree.path).catch(() => false))
          ? "This worktree's folder was deleted outside Tondo. Remove the worktree to forget its thread. Its branch stays."
          : cause instanceof Error
            ? cause.message
            : String(cause);
    }
    if (generation !== this.gitGeneration || this.visibleId !== id || !this.gitConnected) return;
    const json = JSON.stringify({ status, error, activity });
    if (json !== this.lastGit) {
      this.lastGit = json;
      this.send({ v, type: "git-status", threadId: id, status, error, agentCheckout: activity });
    }
    this.gitTimer = setTimeout(() => {
      this.gitReading = this.gitReading.then(() => this.pollGit(id, generation, false));
    }, 2_000);
  }

  private async gitAction(message: Extract<ClientMessage, { type: "git-action" }>): Promise<void> {
    const { threadId, id, action, expectedBranch } = message;
    let error: string | null = null;
    let locked = false;
    try {
      if (threadId !== this.visibleId)
        throw new Error("Open the thread before changing its checkout.");
      if (this.gitMutation) throw new Error("Another Git action is still running.");
      this.gitMutation = locked = true;
      this.gitGeneration++;
      clearTimeout(this.gitTimer);
      // A pre-action gh poll must not cache a stale PR after create completes.
      await this.gitReading;
      const row = this.row(threadId);
      const cwd = this.checkout(row);
      const managed = this.worktrees.forThread(threadId);
      if (action.kind === "remove-worktree" && managed && (await missing(managed.path))) {
        // Deleted outside Tondo: no files are left to lose, only Git's record and the ledger row.
        const thread = this.live.get(threadId);
        await this.terminals.close(threadId);
        if (thread) await this.letGo(thread);
        try {
          if (!(await this.worktrees.forgetIfMissing(managed)))
            throw new Error("The worktree's folder is back. Refresh Git and try again.");
        } catch (cause) {
          this.startThread(threadId).show();
          this.sendSnapshot();
          throw cause;
        }
        await this.retainWorktreeThread(
          threadId,
          managed.repository,
          "The worktree's folder was already gone. Cleared Git's record of it. Its branch and pi session were kept; you can now delete the session.",
        );
        return;
      }
      const status = await this.git.status(cwd, false);
      if (!status.root) throw new Error("This folder is not a Git checkout.");
      if (status.branch !== expectedBranch)
        throw new Error("The branch changed. Review it and try again.");
      // A new worktree reads a committed base into a separate checkout. It doesn't
      // change files, HEAD or the index in the checkout where pi is working.
      if (action.kind !== "new-worktree") {
        const members = [...this.live.values()];
        const roots = await Promise.all(members.map((thread) => checkpointRoot(thread.project)));
        if (members.some((thread, index) => thread.busy && roots[index] === status.root))
          throw new Error(
            "pi is starting or working in this checkout. Wait for every turn and queued prompt to finish before changing Git state.",
          );
      }
      if (["switch", "create-branch", "remove-worktree"].includes(action.kind)) {
        // The pool may have stopped a background thread's pi while its shell lives on.
        const terminalRows = this.store.threads().filter((stored) => this.terminals.has(stored.id));
        const terminalRoots = await Promise.all(
          terminalRows.map((stored) => checkpointRoot(this.checkout(stored))),
        );
        if (terminalRoots.includes(status.root))
          throw new Error(
            "Close terminals in this checkout before changing its branch or removing it.",
          );
      }
      if (action.kind === "new-worktree") {
        const newId = randomUUID();
        await this.worktrees.create(
          status.root,
          newId,
          action.branch,
          action.base,
          this.supervisor.settings().worktreeDirectory,
        );
        this.store.addThread(
          {
            id: newId,
            projectId: row.projectId,
            sessionFile: null,
            createdAt: Date.now(),
          },
          false,
        );
        this.open(newId);
      } else if (action.kind === "remove-worktree") {
        const worktree = this.worktrees.forThread(threadId);
        if (!worktree)
          throw new Error("This thread uses the local checkout, not a managed worktree.");
        if (row.sessionFile && inside(worktree.path, row.sessionFile))
          throw new Error(
            "This thread stores its pi session inside the worktree. Move the session outside it before removing the worktree.",
          );
        // Refused removals must not interrupt pi or lose its extension state.
        await this.worktrees.checkRemoval(worktree, action.force);
        // Stop pi before touching its folder. Removal checks the files again afterward.
        const thread = this.live.get(threadId);
        await this.terminals.close(threadId);
        if (thread) await this.letGo(thread);
        try {
          await this.worktrees.remove(worktree, action.force);
        } catch (cause) {
          this.startThread(threadId).show();
          this.sendSnapshot();
          throw cause;
        }
        await this.retainWorktreeThread(
          threadId,
          worktree.repository,
          "Removed the worktree. Its branch and pi session were kept; you can now delete the session.",
        );
      } else {
        this.toast("info", await this.git.act(cwd, action, expectedBranch));
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (locked) {
        this.gitMutation = false;
        this.refreshGit(true);
      }
      this.send({ v, type: "git-result", threadId, id, error });
    }
  }

  /** After explicit worktree removal, keeps its session addressable for confirmed deletion. */
  private async retainWorktreeThread(
    threadId: string,
    repository: string,
    done: string,
  ): Promise<void> {
    // Checkpoint refs are shared by linked worktrees. Use the surviving
    // repository after removal, and never delete diffs on a refused removal.
    try {
      await deleteCheckpoints(repository, threadId);
      this.store.removeCheckpoints(threadId);
    } catch (cause) {
      this.toast(
        "warning",
        `Worktree removed, but checkpoint cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    // Worktrees removed the checkout ledger entry; the recorded external session
    // path must survive so discovery and Delete can still address this ID.
    this.store.revealThread(threadId);
    this.visibleId = null;
    this.store.setUi("openThread", null);
    this.sendSnapshot();
    this.sendSidebar();
    this.toast("info", done);
  }

  private async deleteThread(id: string): Promise<void> {
    const row = this.row(id);
    const project = this.project(row.projectId);
    const thread = this.live.get(id);
    if (thread?.busy)
      throw new Error(
        "Stop pi first, then wait for queued prompts and checkpoint work to finish before deleting this thread.",
      );
    this.deletingThreads.add(id);
    try {
      const worktree = this.worktrees.forThread(id);
      if (worktree && !(await missing(worktree.path)))
        throw new Error(
          "Remove this thread's managed worktree first, then delete its pi session. Its files and branch have been kept.",
        );
      // Drain discovery before capturing paths, so an older read cannot resurrect the row.
      await this.indexing;
      const files = new Set([
        ...this.index.files(id),
        ...(row.sessionFile === null ? [] : [row.sessionFile]),
        ...(thread?.sessionFile ? [thread.sessionFile] : []),
        ...(this.found.get(id) ? [this.found.get(id)!.summary.file] : []),
      ]);
      await this.terminals.close(id);
      if (thread) await this.letGo(thread);
      await this.closingThreads.get(id);
      // Forget missing-checkout ownership only through the existing Git repair path.
      if (worktree && !(await this.worktrees.forgetIfMissing(worktree)))
        throw new Error("The worktree's folder is back. Remove that worktree first.");
      // Cleanup failures must leave the session resumable, not recreate it from a missing path.
      await this.deleteThreadCheckpoints(id, worktree?.repository ?? project.path);
      await [...files].reduce(async (previous, file) => {
        await previous;
        await this.index.delete(file, id);
        this.offered.delete(file);
      }, Promise.resolve());
      // A refresh requested during shutdown must finish while deletion still holds the guard.
      await this.indexing;
      this.store.removeThread(id);
      this.found.delete(id);
      this.activities.delete(id);
      this.unread.delete(id);
      this.extensionDrafts.delete(id);
      if (this.visibleId === id) {
        this.visibleId = null;
        this.store.setUi("openThread", null);
        this.sendSnapshot();
        this.refreshGit();
      }
      this.sendSidebar();
    } catch (error) {
      // Keep the recoverable row on unlink/cleanup failure, with an actionable error.
      if (this.visibleId === id && !this.live.has(id)) {
        this.visibleId = null;
        this.store.setUi("openThread", null);
        this.sendSnapshot();
      }
      this.sendSidebar();
      throw error;
    } finally {
      this.deletingThreads.delete(id);
    }
  }

  private async removeProject(projectId: number): Promise<void> {
    const project = this.project(projectId);
    if (
      this.store
        .threads()
        .some((row) => row.projectId === projectId && this.deletingThreads.has(row.id))
    )
      throw new Error("Wait for thread deletion to finish before removing this project.");
    // A worktree whose folder was deleted outside Tondo has no files left to keep.
    const worktrees = this.store
      .threads()
      .filter((row) => row.projectId === projectId)
      .flatMap((row) => this.worktrees.forThread(row.id) ?? []);
    const gone = await Promise.all(worktrees.map((worktree) => missing(worktree.path)));
    if (gone.includes(false))
      throw new Error(
        "Remove this project's managed worktrees before removing the project. Their files have been kept.",
      );
    this.removingProjects.add(projectId);
    try {
      const closing = this.store
        .threads()
        .filter((row) => row.projectId === projectId)
        .map((row) => this.terminals.close(row.id));
      for (const thread of this.live.values()) {
        if (thread.projectId !== projectId) continue;
        if (thread.id === this.visibleId) {
          this.visibleId = null;
          this.store.setUi("openThread", null);
        }
        closing.push(this.letGo(thread));
      }
      if (this.visibleId === null) this.sendSnapshot();
      await Promise.all(closing);
      for (const worktree of worktrees) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one Git registration at a time.
        if (!(await this.worktrees.forgetIfMissing(worktree)))
          throw new Error("A worktree's folder is back. Remove that worktree first.");
      }
      for (const row of this.store.threads().filter((stored) => stored.projectId === projectId)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- delete refs before forgetting their owner.
        await this.deleteThreadCheckpoints(row.id, project.path);
      }
      this.store.removeProject(projectId);
      // Titles come from these until the project is really gone.
      for (const [id, entry] of this.found) {
        if (entry.projectId === projectId) this.found.delete(id);
      }
      this.sendSidebar();
    } finally {
      this.removingProjects.delete(projectId);
    }
  }

  /**
   * Forgets a new thread you left without writing anything, so new threads
   * you don't use don't pile up in the sidebar.
   */
  private async forgetIfUnused(id: string): Promise<void> {
    const row = this.store.thread(id);
    const thread = this.live.get(id);
    if (
      !row ||
      row.visible ||
      row.pinned ||
      row.archived ||
      row.draft.trim() ||
      row.hasImages ||
      this.worktrees.forThread(id) ||
      this.gitMutation ||
      this.piUpdating ||
      this.terminals.has(id) ||
      this.forgettingThreads.has(id) ||
      this.deletingThreads.has(id) ||
      this.removingProjects.has(row.projectId)
    )
      return;
    if (row.sessionFile !== null && existsSync(row.sessionFile)) return;
    // An extension command can wait on your answer before the thread has a message.
    if (
      thread &&
      (thread.state.messages.length > 0 ||
        thread.state.running ||
        thread.waiting ||
        thread.preparing ||
        thread.checkpoints.busy)
    ) {
      return;
    }
    const project = this.project(row.projectId);
    this.forgettingThreads.add(id);
    try {
      if (thread) await this.letGo(thread);
      await this.deleteThreadCheckpoints(id, project.path);
      this.store.removeThread(id);
      this.sendSidebar();
    } finally {
      this.forgettingThreads.delete(id);
    }
  }

  private async deleteThreadCheckpoints(id: string, project: string): Promise<void> {
    const roots = new Set(this.store.checkpoints(id).map((record) => record.root));
    // A folder deleted from disk took its refs with it, and Git can't start inside it.
    if (!(await missing(project))) roots.add(await checkpointRoot(project));
    for (const root of roots) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- delete one repository's refs at a time.
      if (root && !(await missing(root))) await deleteCheckpoints(root, id);
    }
  }

  /** Forgets, after Tondo starts, the new threads you left without writing anything. */
  private async forgetUnused(): Promise<void> {
    for (const row of this.store.threads()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- finish cleanup before advancing to the next row.
      if (row.id !== this.visibleId) await this.forgetIfUnused(row.id);
    }
    this.sendSidebar();
  }

  /** Stops the pi of threads you left, as the pool decides. */
  private checkPool(): void {
    clearTimeout(this.poolTimer);
    if (this.piUpdating) return;
    this.poolTimer = undefined;
    const now = Date.now();
    const members = [...this.live.values()]
      .filter(({ status }) => status.state === "starting" || status.state === "ready")
      .map(({ id, busy, visible, lastUsed }) => ({ id, busy, visible, lastUsed }));
    const { stop, nextCheckAt } = choosePiToStop(members, now, this.limits);
    for (const id of stop) {
      const thread = this.live.get(id);
      if (thread) this.run(() => this.letGo(thread));
    }
    if (nextCheckAt !== undefined) {
      this.poolTimer = setTimeout(() => this.checkPool(), Math.max(0, nextCheckAt - now));
    }
  }

  /** Stop idle pi processes before changing their installation. Background threads stay pooled off. */
  private async applyPiUpdate(id: string): Promise<void> {
    if (this.piUpdating) throw new Error("Another pi update is already running.");
    this.piUpdating = true;
    this.piUpdates.setUpdating(true);
    let updated = false;
    try {
      const cwd = this.visibleId ? this.checkout(this.row(this.visibleId)) : null;
      const context = await this.supervisor.maintenanceContext(cwd);
      await this.piUpdates.apply(id, context, async () => {
        if (
          this.gitMutation ||
          this.closingThreads.size ||
          [...this.live.values()].some((thread) => thread.busy || thread.waiting)
        )
          throw new Error(
            "Wait for every pi turn, queued prompt, dialog and Git action to finish before updating.",
          );
        if (this.store.threads().some((row) => this.terminals.has(row.id)))
          throw new Error("Close all integrated terminals before updating pi or its packages.");
        await Promise.all([...this.live.values()].map((thread) => this.letGo(thread)));
      });
      updated = true;
      this.toast(
        "info",
        "Updated. The visible thread resumes with the new pi and packages; other threads resume when opened.",
      );
    } catch (error) {
      this.piUpdates.failed(error);
      throw error;
    } finally {
      try {
        await this.rediscoverPi();
        if (updated) {
          const cwd = this.visibleId ? this.checkout(this.row(this.visibleId)) : null;
          await this.piUpdates.check(await this.supervisor.maintenanceContext(cwd), true);
        }
      } catch (error) {
        this.piUpdates.failed(error);
      } finally {
        this.piUpdating = false;
        if (this.visibleId && this.store.thread(this.visibleId)) this.openThread(this.visibleId);
        this.piUpdates.setUpdating(false);
        this.checkPool();
      }
    }
  }

  /** Stops a thread's pi and reads its session file again for the sidebar. */
  private async letGo(thread: LiveThread): Promise<void> {
    if (this.live.get(thread.id) !== thread) return;
    this.live.delete(thread.id);
    this.activities.delete(thread.id);
    const closing = (async () => {
      await thread.close();
      const file = thread.sessionFile;
      const row = this.store.thread(thread.id);
      if (file !== null && row) {
        const summary = await this.index.summary(file);
        if (summary && !this.deletingThreads.has(thread.id))
          this.found.set(thread.id, { projectId: row.projectId, summary });
      }
      this.scheduleSidebar();
    })();
    this.closingThreads.set(thread.id, closing);
    try {
      await closing;
    } finally {
      this.closingThreads.delete(thread.id);
    }
  }

  private sendSnapshot(): void {
    const thread = this.visibleThread();
    this.send(
      thread
        ? {
            v,
            type: "snapshot",
            thread: this.describe(thread),
            state: thread.snapshot(),
            draft: this.store.thread(thread.id)?.draft ?? "",
            images: this.store.draftImages(thread.id),
            ui: thread.ui,
          }
        : {
            v,
            type: "snapshot",
            thread: null,
            state: NO_THREAD,
            draft: "",
            images: [],
            ui: NO_EXTENSION_UI,
          },
    );
  }

  /** Sends the sidebar within SIDEBAR_DELAY_MS, with any other changes in that time. */
  private scheduleSidebar(): void {
    this.sidebarTimer ??= setTimeout(() => this.sendSidebar(), SIDEBAR_DELAY_MS);
  }

  /** Sends the sidebar now, if it changed. */
  private sendSidebar(): void {
    clearTimeout(this.sidebarTimer);
    this.sidebarTimer = undefined;
    const projects = this.sidebar();
    const json = JSON.stringify(projects);
    if (json === this.lastSidebar) return;
    this.lastSidebar = json;
    this.send({ v, type: "sidebar", projects });
  }

  private sidebar(): SidebarProject[] {
    const rows = new Map(this.store.threads().map((row) => [row.id, row]));
    const projectOf = new Map<string, number>();
    for (const [id, { projectId }] of this.found) projectOf.set(id, projectId);
    // Tondo's store says which project a thread belongs to if the two disagree.
    for (const row of rows.values()) projectOf.set(row.id, row.projectId);
    const threads = new Map<number, SidebarThread[]>();
    for (const [id, projectId] of projectOf) {
      // Only newly created Tondo drafts carry this marker. Resumed and legacy
      // sessions stay listed without depending on their live transcript.
      if (rows.get(id)?.visible === false) continue;
      let list = threads.get(projectId);
      if (!list) threads.set(projectId, (list = []));
      list.push(this.sidebarThread(id, rows.get(id)));
    }
    return this.store.projects().map((project) => ({
      id: project.id,
      path: project.path,
      collapsed: project.collapsed,
      threads: (threads.get(project.id) ?? []).toSorted(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt - a.updatedAt ||
          a.id.localeCompare(b.id),
      ),
    }));
  }

  private sidebarThread(id: string, row: StoredThread | undefined): SidebarThread {
    const summary = this.found.get(id)?.summary;
    const thread = this.live.get(id);
    return {
      id,
      title: this.titleOf(id),
      updatedAt: thread?.updatedAt ?? summary?.updatedAt ?? row?.createdAt ?? 0,
      pinned: row?.pinned ?? false,
      archived: row?.archived ?? false,
      activity: activityOf(thread),
      unread: this.unread.has(id),
      hasDraft: (row?.draft.trim() ?? "") !== "" || (row?.hasImages ?? false),
      worktree: this.worktrees.forThread(id) !== undefined,
      // pi saves a name in the session file, which it writes with the first reply.
      canRename:
        summary !== undefined ||
        (thread?.state.messages.some((message) => message.role === "assistant") ?? false),
    };
  }

  private describe(thread: LiveThread): OpenThread {
    return {
      id: thread.id,
      projectId: thread.projectId,
      project: thread.project,
      title: this.titleOf(thread.id),
      askingTrust: thread.askingTrust,
      preparing: thread.preparing,
      worktree: this.worktrees.forThread(thread.id) !== undefined,
      pi: thread.status,
    };
  }

  /** Your name for the thread, or else the first thing you asked in it. */
  private titleOf(id: string): string {
    const thread = this.live.get(id);
    const summary = this.found.get(id)?.summary;
    const asked = thread?.state.messages.find((message) => message.role === "user");
    const titles = [
      thread?.name,
      summary?.name,
      // Compaction can remove the original prompt from pi's current context,
      // but not from its session file. Prefer that original when it's indexed.
      summary?.firstMessage,
      asked && messageTitle(asked),
    ];
    return titles.find(Boolean) ?? "New thread";
  }

  /** The thread's row in Tondo's store. A session pi wrote outside Tondo gets one the first time you use it. */
  private row(id: string): StoredThread {
    if (this.deletingThreads.has(id)) throw new Error("This thread is being deleted.");
    if (this.forgettingThreads.has(id)) throw new Error("This unused thread is being removed.");
    const row = this.store.thread(id);
    if (row) return row;
    const found = this.found.get(id);
    if (!found) throw new Error(`Tondo has no thread ${id}.`);
    const { file, createdAt } = found.summary;
    this.store.addThread({ id, projectId: found.projectId, sessionFile: file, createdAt });
    return this.store.thread(id)!;
  }

  private project(id: number): StoredProject {
    if (this.removingProjects.has(id)) throw new Error("This project is being removed.");
    const project = this.store.projects().find((candidate) => candidate.id === id);
    if (!project) throw new Error(`Tondo has no project ${id}.`);
    return project;
  }

  /** A thread whose pi Tondo started, for messages that need its pi. */
  private running(id: string): LiveThread {
    if (this.deletingThreads.has(id)) throw new Error("This thread is being deleted.");
    const thread = this.live.get(id);
    if (!thread) throw new Error("pi isn't running in this thread.");
    return thread;
  }

  private visibleThread(): LiveThread | undefined {
    return this.visibleId === null ? undefined : this.live.get(this.visibleId);
  }

  /** Runs `work` and tells the page if it fails. A pi that exited reports itself. */
  private run(work: () => void | Promise<void>): void {
    new Promise<void>((resolve) => resolve(work())).catch((error: unknown) => this.report(error));
  }

  private report(error: unknown): void {
    if (error instanceof PiExitError) return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Tondo Host: ${message}`);
    this.send({ v, type: "error", message });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether pi works in the thread, or waits for your answer to go on. */
function isBusy(activity: ThreadActivity | undefined): boolean {
  return activity === "working" || activity === "waiting";
}

function activityOf(thread: LiveThread | undefined): ThreadActivity {
  if (!thread) return "idle";
  const { status, state } = thread;
  if (status.state === "starting") return "starting";
  if (status.state === "exited") return "error";
  if (thread.waiting) return "waiting";
  if (status.state === "ready" && (state.running || state.compaction || state.retry)) {
    return "working";
  }
  return "idle";
}
