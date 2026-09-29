// A thread the host runs: one pi on one pi session, and the thread state the
// host keeps for it. pi's events apply to the host's copy as they arrive, so
// the host can hand the page the whole thread at any moment. While the thread
// is on screen, the events also go to the page in one batch per frame.
import path from "node:path";
import type { RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import {
  NO_EXTENSION_UI,
  type DialogAnswer,
  type ExtensionDialog,
  type ExtensionUi,
  type ModelOption,
  type NotifyLevel,
  type PiSession,
  type PiStatus,
  type StreamingBehavior,
  type ThinkingLevel,
} from "../shared/protocol";
import {
  afterPiExit,
  applyEvent,
  threadFromMessages,
  type PiEvent,
  type ThreadState,
} from "../shared/thread";
import { applyUiRequest, readUiRequest, responseTo, withoutDialog } from "./extensionUi";
import { PiExitError, type PiProcess } from "./piProcess";
import type { PiRecord } from "./piRpc";
import type { Supervisor, ThreadSession } from "./supervisor";

/** The host has no display to sync to, so it batches on a 60 Hz timer. */
const FRAME_MS = 1000 / 60;

/** Events after which pi's model, thinking level or context may have changed. */
const REFRESH_AFTER = new Set(["agent_settled", "compaction_end", "thinking_level_changed"]);

/** Events after which the sidebar may show the thread differently: whether pi works, or when the thread last moved. */
const CHANGE_AFTER = new Set([
  "agent_start",
  "agent_settled",
  "message_end",
  "queue_update",
  "auto_retry_start",
  "auto_retry_end",
  "compaction_start",
  "compaction_end",
]);

/** The data in pi's answer to a command of type `C`. */
type AnswerData<C extends RpcCommand["type"]> =
  Extract<RpcResponse, { command: C; success: true }> extends { data: infer D } ? D : undefined;

/**
 * Sends `command` and resolves with the data in pi's answer. Pass
 * `deadlineMs` for commands pi may take long to answer.
 */
async function ask<C extends RpcCommand>(
  pi: PiProcess,
  command: C,
  deadlineMs?: number,
): Promise<AnswerData<C["type"]>> {
  const response = await pi.rpc.request(command, deadlineMs);
  return response.data as AnswerData<C["type"]>;
}

/**
 * No deadline. pi answers a prompt only after an extension command it names
 * has finished, which can wait on a dialog for as long as you take, and
 * after any compaction it runs first.
 */
const NO_DEADLINE = Number.POSITIVE_INFINITY;

/** What a LiveThread tells the workspace that holds it. */
export interface ThreadListener {
  /** Events for the page, in one batch per frame, sent only while the thread is on screen. */
  events(events: PiEvent[]): void;
  /** The thread changed whole: pi started and loaded it, or pi exited. */
  reset(): void;
  /** Something the sidebar or the header shows changed: pi's status, whether it works, the name or the trust question. */
  changed(): void;
  /** Text for the composer: messages taken back from pi's queue, or a prompt pi didn't take. */
  restore(text: string): void;
  /** Something failed that you should hear about. */
  error(message: string): void;
  /** What the extensions show changed. `dialogs` is true if a dialog opened or closed. */
  uiChanged(dialogs: boolean): void;
  /** An extension opened a dialog. */
  asked(dialog: ExtensionDialog): void;
  /** An extension's notify. */
  notified(level: NotifyLevel, message: string): void;
  /** An extension set the composer's text. */
  editorText(text: string): void;
}

export class LiveThread {
  readonly id: string;
  readonly projectId: number;
  /** The project folder, where pi runs. */
  readonly project: string;
  /** When you last looked at the thread or pi last finished something in it. */
  lastUsed = Date.now();
  private file: string | null;
  private readonly supervisor: Supervisor;
  private readonly listener: ThreadListener;
  private sessionName: string | undefined;
  private lastMessageAt: number | undefined;
  private waitingForTrust = false;
  private piStatus: PiStatus = { state: "starting" };
  private thread: ThreadState = threadFromMessages([]);
  private onScreen = false;
  private pi: PiProcess | undefined;
  /** The latest open(), which rename waits for. */
  private opening: Promise<void> = Promise.resolve();
  /** Bumped when pi is replaced and when the thread closes, so an old pi's records and answers are dropped. */
  private generation = 0;
  private closed = false;
  /** Events applied to the host's thread that the page hasn't been sent yet. */
  private pending: PiEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private refreshAgain = false;
  /** What this pi's extensions show. It starts over with each pi. */
  private extensionUi: ExtensionUi = NO_EXTENSION_UI;
  /** pi's own options for each open select, which an answer repeats exactly. */
  private readonly selectOptions = new Map<string, readonly string[]>();
  /** Closes each timed dialog when pi answers it for you. */
  private readonly dialogTimers = new Map<string, NodeJS.Timeout>();
  /** Sends status, widget and title changes at most once a frame, since extensions can animate them. */
  private uiTimer: NodeJS.Timeout | undefined;

  constructor(
    project: { readonly id: number; readonly path: string },
    session: ThreadSession,
    supervisor: Supervisor,
    listener: ThreadListener,
  ) {
    this.id = session.id;
    this.projectId = project.id;
    this.project = project.path;
    this.file = session.file;
    this.supervisor = supervisor;
    this.listener = listener;
  }

  /** Where pi keeps the session. pi says at start, and writes it with the first reply. */
  get sessionFile(): string | null {
    return this.file;
  }

  /** The name pi has for the session, if you gave it one. */
  get name(): string | undefined {
    return this.sessionName;
  }

  /** When you or pi last added a message while the thread was live. */
  get updatedAt(): number | undefined {
    return this.lastMessageAt;
  }

  /** Whether Tondo is waiting to hear if pi may load the project's own settings and extensions. */
  get askingTrust(): boolean {
    return this.waitingForTrust;
  }

  get status(): PiStatus {
    return this.piStatus;
  }

  get state(): ThreadState {
    return this.thread;
  }

  get visible(): boolean {
    return this.onScreen;
  }

  /** What the thread's extensions show. */
  get ui(): ExtensionUi {
    return this.extensionUi;
  }

  /** Whether an extension waits for your answer to a dialog. */
  get waiting(): boolean {
    return this.extensionUi.dialogs.length > 0;
  }

  /**
   * Whether pi is starting or working, holds messages you queued, or waits
   * for your answer. The pool never stops a busy thread's pi.
   */
  get busy(): boolean {
    const { running, compaction, retry, queue } = this.thread;
    return (
      this.piStatus.state === "starting" ||
      running ||
      compaction !== null ||
      retry !== null ||
      queue.steering.length + queue.followUp.length > 0 ||
      this.waiting
    );
  }

  /** Puts the thread on screen. Its events go to the page after its next snapshot. */
  show(): void {
    this.onScreen = true;
  }

  /** The whole thread for a snapshot. It holds every event not sent yet, so they're dropped. */
  snapshot(): ThreadState {
    this.dropPending();
    return this.thread;
  }

  /** Takes the thread off screen. Its events keep applying to the host's copy. */
  hide(): void {
    this.onScreen = false;
    this.dropPending();
  }

  /** Starts pi, after asking whether to trust the project if pi needs to know. It resolves once pi is ready, waiting for you, or gone. */
  open(): Promise<void> {
    this.opening = this.openOnce(++this.generation);
    return this.opening;
  }

  /** Your answer to whether to trust the project. Tondo remembers it and starts pi. */
  async trust(trusted: boolean): Promise<void> {
    if (!this.waitingForTrust) throw new Error("Tondo isn't asking whether to trust this project.");
    this.supervisor.saveTrustAnswer(this.project, trusted);
    this.waitingForTrust = false;
    this.opening = this.start(++this.generation);
    await this.opening;
  }

  /** Starts pi again after it exited. It opens the same session. */
  async restart(): Promise<void> {
    if (this.piStatus.state !== "exited")
      throw new Error("pi hasn't exited, so there's nothing to restart.");
    await this.open();
  }

  /** Sends `text` to pi. While pi works, it joins the queue the way `streamingBehavior` says. */
  async prompt(text: string, streamingBehavior: StreamingBehavior): Promise<void> {
    const { pi } = this.ready();
    try {
      // pi ignores streamingBehavior when it's idle, so the page needn't know
      // whether pi finished just before you pressed Enter.
      await ask(pi, { type: "prompt", message: text, streamingBehavior }, NO_DEADLINE);
    } catch (error) {
      // pi didn't take the text, so it goes back into the composer.
      this.restore([text]);
      throw error;
    }
  }

  /** Escape: takes pi's queue back into the composer, then stops pi. pi's rpc.md asks for this order. */
  async stop(): Promise<void> {
    const { pi } = this.ready();
    await this.takeQueue(pi);
    await ask(pi, { type: "abort" });
  }

  /** Alt+Up: takes pi's queue back into the composer. */
  async dequeue(): Promise<void> {
    await this.takeQueue(this.ready().pi);
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const { pi, session } = this.ready();
    if (!session.models.some((model) => model.provider === provider && model.id === modelId)) {
      throw new Error(`pi doesn't offer the model ${provider}/${modelId}.`);
    }
    await ask(pi, { type: "set_model", provider, modelId });
    this.refresh();
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const { pi, session } = this.ready();
    if (!session.thinkingLevels.includes(level)) {
      throw new Error(`The model doesn't offer the thinking level ${level}.`);
    }
    await ask(pi, { type: "set_thinking_level", level });
    this.refresh();
  }

  /** Your answer to an extension's dialog. An answer to a dialog that has closed does nothing. */
  answer(dialogId: string, answer: DialogAnswer): void {
    const dialog = this.extensionUi.dialogs.find((open) => open.id === dialogId);
    // pi answered it for you when it timed out, or it went with its pi.
    if (!dialog || !this.pi) return;
    this.pi.rpc.send(responseTo(dialog, answer, this.selectOptions.get(dialogId)));
    this.closeDialog(dialogId);
  }

  /** Names the session. pi saves the name in the session file, as /name does. */
  async rename(name: string): Promise<void> {
    await this.opening;
    if (this.waitingForTrust) {
      throw new Error(
        "Open the thread and answer whether to trust its project before you rename it.",
      );
    }
    const { pi } = this.ready();
    await ask(pi, { type: "set_session_name", name });
    this.sessionName = name;
    this.changed();
  }

  /** Stops pi for good. The thread reports nothing after this. */
  async close(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.dropPending();
    this.clearUi();
    const pi = this.pi;
    this.pi = undefined;
    await pi?.stop();
  }

  private async openOnce(generation: number): Promise<void> {
    this.setStatus({ state: "starting" });
    let asking: boolean;
    try {
      asking = await this.supervisor.needsTrustAnswer(this.project);
    } catch (error) {
      if (generation === this.generation)
        this.setStatus({ state: "exited", error: messageOf(error) });
      return;
    }
    if (generation !== this.generation) return;
    if (asking) {
      this.waitingForTrust = true;
      this.setStatus({ state: "stopped" });
      return;
    }
    await this.start(generation);
  }

  private async start(generation: number): Promise<void> {
    // The new pi's extensions show what they show from scratch, and they may
    // start as soon as pi does, before it answers anything.
    this.clearUi();
    this.setStatus({ state: "starting" });
    try {
      const session: ThreadSession = { id: this.id, file: this.file };
      const pi = await this.supervisor.start(this.project, session, (record) => {
        if (generation === this.generation) this.receive(record);
      });
      if (generation !== this.generation) {
        await pi.stop();
        return;
      }
      this.pi = pi;
      void pi.exited.then((exit) => {
        if (generation === this.generation) this.lost(new PiExitError(exit));
      });
      const [read, { messages }] = await Promise.all([
        this.readSession(pi),
        ask(pi, { type: "get_messages" }),
      ]);
      if (generation !== this.generation) return;
      this.thread = threadFromMessages(messages);
      this.piStatus = { state: "ready", session: read.session };
      this.sessionName = read.name;
      if (read.file) this.file = read.file;
      this.dropPending();
      this.listener.reset();
    } catch (error) {
      // lost() reports a pi that exited.
      if (generation !== this.generation || error instanceof PiExitError) return;
      // pi couldn't start, or it started and didn't answer. It's no use either way.
      this.generation++;
      const pi = this.pi;
      this.pi = undefined;
      void pi?.stop();
      console.error(`Tondo Host couldn't start pi in ${this.project}:`, error);
      this.setStatus({ state: "exited", error: messageOf(error) });
    }
  }

  /** pi exited without Tondo stopping it. */
  private lost(error: PiExitError): void {
    console.error(`Tondo Host: pi in ${this.project}: ${error.message}`);
    this.pi = undefined;
    const { steering, followUp } = this.thread.queue;
    this.thread = afterPiExit(this.thread);
    this.piStatus = { state: "exited", error: error.message };
    this.dropPending();
    // What pi's extensions showed, and the dialogs they waited on, went with it.
    this.clearUi();
    this.listener.reset();
    // pi's queue went with it, so the messages in it go back into the composer.
    this.restore([...steering, ...followUp]);
  }

  private receive(record: PiRecord): void {
    if (record.type === "extension_ui_request") {
      this.receiveUi(record);
      return;
    }
    if (record.type === "extension_error") {
      this.fail(`The extension ${record.extensionPath} failed on ${record.event}: ${record.error}`);
      return;
    }
    const event = record as PiEvent;
    if (event.type === "session_info_changed") {
      this.sessionName = event.name?.trim() || undefined;
      this.changed();
      return;
    }
    const next = applyEvent(this.thread, event);
    if (next !== this.thread) {
      this.thread = next;
      if (this.onScreen) {
        this.pending.push(event);
        this.flushTimer ??= setTimeout(() => this.flush(), FRAME_MS);
      }
    }
    if (event.type === "message_end") {
      const { role } = event.message;
      if (role === "user" || role === "assistant") this.lastMessageAt = Date.now();
    }
    if (event.type === "agent_settled") this.lastUsed = Date.now();
    if (event.type === "compaction_end" && event.errorMessage && !event.aborted) {
      // pi's message says what failed: "Compaction failed: …", "Auto-compaction failed: …".
      this.fail(event.errorMessage);
    }
    if (CHANGE_AFTER.has(event.type)) this.changed();
    if (
      REFRESH_AFTER.has(event.type) ||
      (event.type === "message_end" && event.message.role === "assistant")
    ) {
      this.refresh();
    }
  }

  /** An extension asked for a dialog, or to show or set something. */
  private receiveUi(record: PiRecord): void {
    const request = readUiRequest(record, Date.now());
    switch (request.kind) {
      case "dialog": {
        const { dialog, options } = request;
        this.extensionUi = applyUiRequest(this.extensionUi, request);
        if (options) this.selectOptions.set(dialog.id, options);
        if (dialog.expiresAt !== null) {
          const timer = setTimeout(
            () => this.closeDialog(dialog.id),
            Math.max(0, dialog.expiresAt - Date.now()),
          );
          this.dialogTimers.set(dialog.id, timer);
        }
        this.uiChanged(true);
        if (!this.closed) this.listener.asked(dialog);
        break;
      }
      case "bad-dialog":
        // Answering it cancelled lets the extension go on instead of waiting for ever.
        console.error(
          `Tondo Host: an extension in ${this.project} asked with a dialog Tondo can't show.`,
        );
        this.pi?.rpc.send({ type: "extension_ui_response", id: request.id, cancelled: true });
        break;
      case "notify":
        if (this.closed) break;
        this.flush();
        this.listener.notified(request.level, request.message);
        break;
      case "editor-text":
        if (!this.closed) this.listener.editorText(request.text);
        break;
      case "status":
      case "widget":
      case "title": {
        const next = applyUiRequest(this.extensionUi, request);
        if (next === this.extensionUi) break;
        this.extensionUi = next;
        this.uiTimer ??= setTimeout(() => this.uiChanged(false), FRAME_MS);
        break;
      }
      case "ignored":
        break;
    }
  }

  /** Takes a dialog away: you answered it, or pi answered it for you when it timed out. */
  private closeDialog(id: string): void {
    clearTimeout(this.dialogTimers.get(id));
    this.dialogTimers.delete(id);
    this.selectOptions.delete(id);
    const next = withoutDialog(this.extensionUi, id);
    if (next === this.extensionUi) return;
    this.extensionUi = next;
    this.uiChanged(true);
  }

  /** Forgets what pi's extensions showed, when their pi is gone. */
  private clearUi(): void {
    for (const timer of this.dialogTimers.values()) clearTimeout(timer);
    this.dialogTimers.clear();
    this.selectOptions.clear();
    const shown = this.extensionUi !== NO_EXTENSION_UI;
    this.extensionUi = NO_EXTENSION_UI;
    if (shown) this.uiChanged(true);
  }

  /** Tells the workspace what the extensions show now, after the events before it. */
  private uiChanged(dialogs: boolean): void {
    clearTimeout(this.uiTimer);
    this.uiTimer = undefined;
    if (this.closed) return;
    this.flush();
    this.listener.uiChanged(dialogs);
  }

  private async takeQueue(pi: PiProcess): Promise<void> {
    const { steering, followUp } = await ask(pi, { type: "clear_queue" });
    this.restore([...steering, ...followUp]);
  }

  /** Re-reads pi's model, thinking level and context, one read at a time. */
  private refresh(): void {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    const { pi, piStatus, generation } = this;
    if (!pi || piStatus.state !== "ready") return;
    this.refreshing = true;
    this.readSession(pi, piStatus.session.models)
      .then(
        ({ session }) => {
          if (generation !== this.generation || this.piStatus.state !== "ready") return;
          if (JSON.stringify(session) === JSON.stringify(this.piStatus.session)) return;
          this.setStatus({ state: "ready", session });
        },
        (error: unknown) => {
          if (generation !== this.generation || error instanceof PiExitError) return;
          this.fail(`Tondo couldn't read pi's model and context: ${messageOf(error)}`);
        },
      )
      .finally(() => {
        this.refreshing = false;
        if (this.refreshAgain) {
          this.refreshAgain = false;
          this.refresh();
        }
      });
  }

  /**
   * What pi says about its model, thinking level and context, and the
   * session's name and file. Pass `models` to skip asking for the list again.
   */
  private async readSession(
    pi: PiProcess,
    models?: readonly ModelOption[],
  ): Promise<{ session: PiSession; name: string | undefined; file: string | undefined }> {
    const [state, { levels }, stats, available] = await Promise.all([
      ask(pi, { type: "get_state" }),
      ask(pi, { type: "get_available_thinking_levels" }),
      ask(pi, { type: "get_session_stats" }),
      models ??
        ask(pi, { type: "get_available_models" }).then((data) =>
          data.models.map(({ provider, id, name }) => ({ provider, id, name })),
        ),
    ]);
    return {
      session: {
        model: state.model ? { provider: state.model.provider, id: state.model.id } : null,
        models: available,
        thinkingLevel: state.thinkingLevel,
        thinkingLevels: levels,
        context: stats.contextUsage ?? null,
      },
      name: state.sessionName?.trim() || undefined,
      // pi gives the file relative to the project when its session folder setting is relative.
      file: state.sessionFile && path.resolve(this.project, state.sessionFile),
    };
  }

  private ready(): { pi: PiProcess; session: PiSession } {
    if (!this.pi || this.piStatus.state !== "ready") throw new Error("pi isn't ready.");
    return { pi: this.pi, session: this.piStatus.session };
  }

  private setStatus(status: PiStatus): void {
    this.piStatus = status;
    this.changed();
  }

  /** Tells the workspace, after the events that came before. */
  private changed(): void {
    if (this.closed) return;
    this.flush();
    this.listener.changed();
  }

  /** Puts `texts` back into the composer. */
  private restore(texts: readonly string[]): void {
    if (this.closed || texts.length === 0) return;
    this.flush();
    this.listener.restore(texts.join("\n\n"));
  }

  private fail(message: string): void {
    console.error(`Tondo Host: ${message}`);
    this.flush();
    this.listener.error(message);
  }

  private flush(): void {
    const events = this.pending;
    this.dropPending();
    if (events.length > 0) this.listener.events(events);
  }

  private dropPending(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.pending = [];
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
