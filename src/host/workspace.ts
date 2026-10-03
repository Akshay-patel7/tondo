// Everything the sidebar lists and the threads Tondo runs. Projects are
// folders you add. Each lists the pi sessions it has, including ones you
// started in pi's own interface, merged with what Tondo's store remembers:
// threads too new for pi to have saved, and what you pinned, archived or
// drafted. A thread runs a pi only while you use it, and the pool stops the
// ones you left.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
import { FileIndexes } from "./fileIndex";
import { checkpointRoot, deleteCheckpoints } from "./checkpoints";
import { TurnCheckpoints } from "./turnCheckpoints";
import type { DraftImage } from "../shared/images";
import { LiveThread, type ThreadListener } from "./liveThread";
import { PiExitError } from "./piProcess";
import { PiCommandError } from "./piRpc";
import { choosePiToStop, type PoolLimits } from "./pool";
import { messageTitle, SessionIndex, type SessionSummary } from "./sessionIndex";
import type { Store, StoredProject, StoredThread } from "./store";
import type { Supervisor } from "./supervisor";
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
  readonly store: Store;
  readonly supervisor: Supervisor;
  readonly limits: PoolLimits;
  /** Sends a message to the page, if one is connected. */
  readonly send: (message: HostMessage) => void;
  /** Asks main to show the folder dialog. Main answers through projectChosen. */
  readonly chooseFolder: () => void;
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
  private readonly limits: PoolLimits;
  private readonly send: (message: HostMessage) => void;
  private readonly chooseFolder: () => void;
  private readonly attention: (attention: Attention) => void;
  private readonly copy: (text: string) => void;
  private readonly reveal: (file: string) => void;
  /** Files the page may ask main to show in Finder: the ones Tondo offered it. */
  private readonly offered = new Set<string>();
  private readonly index = new SessionIndex();
  private readonly files = new FileIndexes();
  private readonly terminals: Terminals;
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
  private indexing: Promise<void> = Promise.resolve();
  private refreshQueued = false;
  private sidebarTimer: NodeJS.Timeout | undefined;
  private lastSidebar = "";
  private poolTimer: NodeJS.Timeout | undefined;

  constructor(options: WorkspaceOptions) {
    this.store = options.store;
    this.supervisor = options.supervisor;
    this.limits = options.limits;
    this.send = options.send;
    this.chooseFolder = options.chooseFolder;
    this.attention = options.attention;
    this.copy = options.copy;
    this.reveal = options.reveal;
    this.terminals = new Terminals(
      async (threadId, kind) => {
        const row = this.row(threadId);
        const project = this.project(row.projectId);
        if (await this.supervisor.needsTrustAnswer(project.path))
          throw new Error("Answer the project's trust question before opening its terminal.");
        return this.supervisor.terminalLaunch(project.path, kind);
      },
      this.send,
      options.terminalGroups,
    );
  }

  disconnected(): void {
    this.terminals.detachAll();
  }

  closeTerminals(): Promise<void> {
    return this.terminals.closeAll();
  }

  /** You clicked a notification about the thread. */
  openThread(threadId: string): void {
    this.run(() => this.open(threadId));
  }

  /** Reopens the thread you had open, then reads every project's sessions. */
  start(): Promise<void> {
    const { openThread } = this.store.ui();
    if (openThread !== null && this.store.thread(openThread)) this.run(() => this.open(openThread));
    return this.refresh().then(() => this.run(() => this.forgetUnused()));
  }

  /** Sends a new page everything it shows. */
  greet(): void {
    this.send({ v, type: "ui", sidebarHidden: this.store.ui().sidebarHidden });
    this.sendSnapshot();
    this.lastSidebar = "";
    this.sendSidebar();
    this.terminals.greet();
  }

  handle(message: ClientMessage): void {
    switch (message.type) {
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
          this.chooseFolder();
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
      case "archive-thread":
        this.run(() => {
          this.row(message.threadId);
          this.store.setArchived(message.threadId, message.archived);
          this.sendSidebar();
        });
        break;
      case "set-draft":
        this.run(() => this.setDraft(message.threadId, message.text));
        break;
      case "set-draft-images":
        this.run(() => {
          this.row(message.threadId);
          this.store.setDraftImages(message.threadId, message.images);
          this.scheduleSidebar();
        });
        break;
      case "list-checkpoints":
        this.run(() => this.sendCheckpoints(this.running(message.threadId)));
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
          const project = this.project(row.projectId);
          const index = await this.files.read(project.path);
          this.send({ v, type: "files", threadId: message.threadId, id: message.id, index });
        });
        break;
      case "set-sidebar-hidden":
        this.run(() => this.store.setUi("sidebarHidden", message.hidden));
        break;
      case "refresh":
        this.run(() => this.refresh());
        break;
      case "trust":
        this.run(() => this.running(message.threadId).trust(message.trusted));
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
      case "settings-files":
        this.run(async () => {
          const { project } = this.running(message.threadId);
          const files = await this.supervisor.settingsFiles(project);
          for (const file of files) if (file.exists) this.offered.add(file.path);
          const sheet = { kind: "settings", files } as const;
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
    }
  }

  /** The folder you picked in the dialog, or null if you cancelled. It opens a new thread there. */
  projectChosen(folder: string | null): void {
    this.choosing = false;
    if (folder === null) return;
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
        const folder = await this.supervisor.sessionFolder(project.path);
        return this.index.list(project.path, folder);
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
      for (const summary of result.value) found.set(summary.id, { projectId: project.id, summary });
      listed.add(project.id);
    }
    // A thread's file can be outside the folder, such as after you change pi's sessionDir.
    const outside = this.store
      .threads()
      .filter((row) => listed.has(row.projectId) && row.sessionFile !== null && !found.has(row.id));
    const summaries = await Promise.all(outside.map((row) => this.index.summary(row.sessionFile!)));
    outside.forEach((row, i) => {
      const summary = summaries[i];
      if (summary) found.set(row.id, { projectId: row.projectId, summary });
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
    this.store.addThread({ id, projectId, sessionFile: null, createdAt: Date.now() });
    this.open(id);
  }

  /** Puts a thread on screen, starting its pi if it isn't running. */
  private open(id: string): void {
    if (id === this.visibleId) return;
    const existing = this.live.get(id);
    const thread = existing ?? this.startThread(id);
    // You may have answered for the project in another thread since.
    if (existing?.askingTrust) this.run(() => existing.open());
    const previous = this.visibleThread();
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
    if (previous) this.run(() => this.forgetIfUnused(previous.id));
    this.sendSidebar();
    this.checkPool();
  }

  /** Starts a thread's pi, off screen until you open it. */
  private startThread(id: string): LiveThread {
    const row = this.row(id);
    const project = this.project(row.projectId);
    const thread: LiveThread = new LiveThread(
      project,
      { id, file: row.sessionFile },
      this.supervisor,
      this.listen(() => thread),
      new TurnCheckpoints(this.store, id, project.path, () => {
        const current = this.live.get(id);
        if (current?.visible) this.run(() => this.sendCheckpoints(current));
        this.checkPool();
      }),
    );
    this.live.set(id, thread);
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
    this.send({
      v,
      type: "checkpoints",
      threadId: thread.id,
      turns: thread.checkpoints.turns,
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
        if (thread?.visible) this.send({ v, type: "events", threadId: thread.id, events });
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
        // A thread that isn't on screen keeps the text as its draft.
        else this.setDraft(thread.id, text);
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
        thread = this.running(threadId);
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

  private setDraft(id: string, text: string): void {
    const had = this.row(id).draft.trim() !== "";
    this.store.setDraft(id, text);
    if (had !== (text.trim() !== "")) this.scheduleSidebar();
  }

  private async removeProject(projectId: number): Promise<void> {
    const project = this.project(projectId);
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
      for (const [id, entry] of this.found) {
        if (entry.projectId === projectId) this.found.delete(id);
      }
      for (const row of this.store.threads().filter((stored) => stored.projectId === projectId)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- delete refs before forgetting their owner.
        await this.deleteThreadCheckpoints(row.id, project.path);
      }
      this.store.removeProject(projectId);
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
      row.pinned ||
      row.archived ||
      row.draft.trim() ||
      row.hasImages ||
      this.terminals.has(id) ||
      this.forgettingThreads.has(id) ||
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
    roots.add(await checkpointRoot(project));
    for (const root of roots) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- delete one repository's refs at a time.
      if (root) await deleteCheckpoints(root, id);
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

  /** Stops a thread's pi and reads its session file again for the sidebar. */
  private async letGo(thread: LiveThread): Promise<void> {
    if (this.live.get(thread.id) !== thread) return;
    this.live.delete(thread.id);
    this.activities.delete(thread.id);
    await thread.close();
    const file = thread.sessionFile;
    const row = this.store.thread(thread.id);
    if (file !== null && row) {
      const summary = await this.index.summary(file);
      if (summary) this.found.set(thread.id, { projectId: row.projectId, summary });
    }
    this.scheduleSidebar();
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
      asked && messageTitle(asked),
      summary?.firstMessage,
    ];
    return titles.find(Boolean) ?? "New thread";
  }

  /** The thread's row in Tondo's store. A session pi wrote outside Tondo gets one the first time you use it. */
  private row(id: string): StoredThread {
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
