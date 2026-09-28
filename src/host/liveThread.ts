// A thread the host runs: one pi in a project folder, the thread state the
// host keeps for it, and what the page sees of both. pi's events apply to the
// host's copy as they arrive and go to the page in one batch per frame, so a
// page that connects mid-stream gets the whole thread as it stands.
import { randomUUID } from "node:crypto";
import type { RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import {
  PROTOCOL_VERSION,
  type HostMessage,
  type ModelOption,
  type PiSession,
  type PiStatus,
  type StreamingBehavior,
  type ThinkingLevel,
  type Workspace,
} from "../shared/protocol";
import {
  afterPiExit,
  applyEvent,
  threadFromMessages,
  type PiEvent,
  type ThreadState,
} from "../shared/thread";
import { PiExitError, type PiProcess } from "./piProcess";
import type { PiRecord } from "./piRpc";
import type { Supervisor } from "./supervisor";

const v = PROTOCOL_VERSION;

/** The host has no display to sync to, so it batches on a 60 Hz timer. */
const FRAME_MS = 1000 / 60;

/** Events after which pi's model, thinking level or context may have changed. */
const REFRESH_AFTER = new Set(["agent_settled", "compaction_end", "thinking_level_changed"]);

/** Extension dialogs that wait for an answer. Stage 7 shows them, and until then the host cancels them. */
const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

/** The data in pi's answer to a command of type `C`. */
type AnswerData<C extends RpcCommand["type"]> =
  Extract<RpcResponse, { command: C; success: true }> extends { data: infer D } ? D : undefined;

async function ask<C extends RpcCommand>(
  pi: PiProcess,
  command: C,
): Promise<AnswerData<C["type"]>> {
  const response = await pi.rpc.request(command);
  return response.data as AnswerData<C["type"]>;
}

export class LiveThread {
  readonly project: string;
  /** Every pi this thread starts opens this session, so a restart keeps the transcript. */
  private readonly sessionId = randomUUID();
  private readonly supervisor: Supervisor;
  private readonly send: (message: HostMessage) => void;
  private askingTrust = false;
  private status: PiStatus = { state: "starting" };
  private thread: ThreadState = threadFromMessages([]);
  private pi: PiProcess | undefined;
  /** Bumped when pi is replaced and when the thread closes, so an old pi's records and answers are dropped. */
  private generation = 0;
  private closed = false;
  /** Events applied to the host's thread that the page hasn't been sent yet. */
  private pending: PiEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private refreshAgain = false;

  /** `send` delivers messages to the page, if one is connected. */
  constructor(project: string, supervisor: Supervisor, send: (message: HostMessage) => void) {
    this.project = project;
    this.supervisor = supervisor;
    this.send = send;
  }

  get workspace(): Workspace {
    return { project: this.project, askingTrust: this.askingTrust, pi: this.status };
  }

  /** The whole thread, for a page that has none of it. It holds the events not sent yet, so they're dropped. */
  snapshot(): HostMessage {
    this.dropPending();
    return { v, type: "snapshot", workspace: this.workspace, thread: this.thread };
  }

  /** Starts pi, after asking whether to trust the project if pi needs to know. */
  async open(): Promise<void> {
    const generation = ++this.generation;
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
      this.askingTrust = true;
      this.setStatus({ state: "stopped" });
      return;
    }
    await this.start(generation);
  }

  /** Your answer to whether to trust the project. Tondo remembers it and starts pi. */
  async trust(trusted: boolean): Promise<void> {
    if (!this.askingTrust) throw new Error("Tondo isn't asking whether to trust this project.");
    this.supervisor.saveTrustAnswer(this.project, trusted);
    this.askingTrust = false;
    await this.start(++this.generation);
  }

  /** Starts pi again after it exited. It opens the same session. */
  async restart(): Promise<void> {
    if (this.status.state !== "exited")
      throw new Error("pi hasn't exited, so there's nothing to restart.");
    await this.open();
  }

  /** Sends `text` to pi. While pi works, it joins the queue the way `streamingBehavior` says. */
  async prompt(text: string, streamingBehavior: StreamingBehavior): Promise<void> {
    const { pi } = this.ready();
    try {
      // pi ignores streamingBehavior when it's idle, so the page needn't know
      // whether pi finished just before you pressed Enter.
      await ask(pi, { type: "prompt", message: text, streamingBehavior });
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

  /** Stops pi for good. The thread sends nothing after this. */
  async close(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.dropPending();
    const pi = this.pi;
    this.pi = undefined;
    await pi?.stop();
  }

  private async start(generation: number): Promise<void> {
    this.setStatus({ state: "starting" });
    try {
      const pi = await this.supervisor.start(this.project, this.sessionId, (record) => {
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
      const [session, { messages }] = await Promise.all([
        this.readSession(pi),
        ask(pi, { type: "get_messages" }),
      ]);
      if (generation !== this.generation) return;
      this.thread = threadFromMessages(messages);
      this.status = { state: "ready", session };
      this.send(this.snapshot());
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
    this.status = { state: "exited", error: error.message };
    this.send(this.snapshot());
    // pi's queue went with it, so the messages in it go back into the composer.
    this.restore([...steering, ...followUp]);
  }

  private receive(record: PiRecord): void {
    if (record.type === "extension_ui_request") {
      if (DIALOGS.has(record.method as string)) {
        this.pi?.rpc.send({ type: "extension_ui_response", id: record.id, cancelled: true });
      }
      return;
    }
    if (record.type === "extension_error") {
      this.fail(`The extension ${record.extensionPath} failed on ${record.event}: ${record.error}`);
      return;
    }
    const event = record as PiEvent;
    const next = applyEvent(this.thread, event);
    if (next !== this.thread) {
      this.thread = next;
      this.pending.push(event);
      this.flushTimer ??= setTimeout(() => this.flush(), FRAME_MS);
    }
    if (event.type === "compaction_end" && event.errorMessage && !event.aborted) {
      this.fail(`Compaction failed: ${event.errorMessage}`);
    }
    if (
      REFRESH_AFTER.has(event.type) ||
      (event.type === "message_end" && event.message.role === "assistant")
    ) {
      this.refresh();
    }
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
    const { pi, status, generation } = this;
    if (!pi || status.state !== "ready") return;
    this.refreshing = true;
    this.readSession(pi, status.session.models)
      .then(
        (session) => {
          if (generation !== this.generation || this.status.state !== "ready") return;
          if (JSON.stringify(session) === JSON.stringify(this.status.session)) return;
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

  /** What pi says about its model, thinking level and context. Pass `models` to skip asking for the list again. */
  private async readSession(pi: PiProcess, models?: readonly ModelOption[]): Promise<PiSession> {
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
      model: state.model ? { provider: state.model.provider, id: state.model.id } : null,
      models: available,
      thinkingLevel: state.thinkingLevel,
      thinkingLevels: levels,
      context: stats.contextUsage ?? null,
    };
  }

  private ready(): { pi: PiProcess; session: PiSession } {
    if (!this.pi || this.status.state !== "ready") throw new Error("pi isn't ready.");
    return { pi: this.pi, session: this.status.session };
  }

  private setStatus(status: PiStatus): void {
    this.status = status;
    this.post({ v, type: "workspace", workspace: this.workspace });
  }

  /** Puts `texts` back into the composer. */
  private restore(texts: readonly string[]): void {
    if (this.closed || texts.length === 0) return;
    this.post({ v, type: "restore", text: texts.join("\n\n") });
  }

  private fail(message: string): void {
    console.error(`Tondo Host: ${message}`);
    this.post({ v, type: "error", message });
  }

  /** Sends `message` after the events that came before it. */
  private post(message: HostMessage): void {
    this.flush();
    this.send(message);
  }

  private flush(): void {
    const events = this.pending;
    this.dropPending();
    if (events.length > 0) this.send({ v, type: "events", events });
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
