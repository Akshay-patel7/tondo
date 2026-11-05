import { DEFAULT_SETTINGS } from "../shared/settings";
import { remotePayloadBytes } from "../shared/remotePayload";
import {
  PROTOCOL_VERSION as v,
  NO_EXTENSION_UI,
  parseClientMessage,
  type ClientMessage,
  type HostMessage,
  type OpenThread,
  type SidebarProject,
} from "../shared/protocol";
import { threadFromMessages, type PiEvent, type ThreadState } from "../shared/thread";
import {
  REMOTE_FRAME_BYTES,
  REMOTE_MAX_CLIENTS,
  REMOTE_RECENT_MESSAGES,
  remoteRequestAllowed,
  type HostToRemote,
  type RemoteToHost,
} from "../shared/remote";
import { SessionHistory } from "./history";
import type { LiveThread } from "./liveThread";

interface Peer {
  thread?: LiveThread | undefined;
  unobserve?: () => void;
  history?: SessionHistory | undefined;
  historyAbort?: AbortController;
  omittedMessages: number;
  generation: number;
  pending: number;
  busy: boolean;
  queue: { message: HostMessage; bytes: number }[];
  queuedBytes: number;
}

interface RemoteWorkspaceOptions {
  thread: (id: string) => LiveThread;
  newThread: (projectId: number) => string;
  describe: (thread: LiveThread) => OpenThread;
  sidebar: () => SidebarProject[];
  prompt: (message: Extract<ClientMessage, { type: "prompt" }>) => Promise<void>;
  checkPool: () => void;
}

/** Independent views of the same live threads, not another Workspace or pi pool. */
export class RemoteWorkspace {
  private readonly peers = new Map<string, Peer>();
  private readonly post: (message: HostToRemote) => void;
  private readonly options: RemoteWorkspaceOptions;

  constructor(options: RemoteWorkspaceOptions, post: (message: HostToRemote) => void) {
    this.options = options;
    this.post = post;
  }

  close(): void {
    for (const id of this.peers.keys()) this.disconnect(id);
  }

  handle(input: RemoteToHost): void {
    const { clientId } = input;
    if (input.type === "connect") {
      if (this.peers.size >= REMOTE_MAX_CLIENTS || this.peers.has(clientId)) return;
      this.peers.set(clientId, {
        generation: 0,
        pending: 0,
        busy: false,
        queue: [],
        omittedMessages: 0,
        queuedBytes: 0,
      });
      this.send(clientId, {
        v,
        type: "settings",
        settings: DEFAULT_SETTINGS,
        error: null,
        fileProblem: null,
      });
      this.send(clientId, {
        v,
        type: "snapshot",
        thread: null,
        state: threadFromMessages([]),
        draft: "",
        images: [],
        ui: NO_EXTENSION_UI,
      });
      this.send(clientId, { v, type: "sidebar", projects: this.options.sidebar() });
      return;
    }
    if (input.type === "disconnect") {
      this.disconnect(clientId);
      return;
    }
    const peer = this.peers.get(clientId);
    if (!peer) return;
    if (input.type === "delivered") {
      peer.busy = false;
      this.pump(clientId, peer);
      return;
    }
    const parsed = parseClientMessage(input.message);
    if (!parsed.ok || !remoteRequestAllowed(parsed.message) || peer.pending >= 8) {
      this.post({ type: "close", clientId, reason: "Remote request not allowed" });
      this.disconnect(clientId);
      return;
    }
    peer.pending++;
    void this.request(clientId, peer, parsed.message)
      .then(
        () => {
          this.send(clientId, { v, type: "remote-result", id: input.id, error: null });
        },
        (error: unknown) => {
          this.send(clientId, {
            v,
            type: "remote-result",
            id: input.id,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .finally(() => {
        peer.pending--;
      });
  }

  events(threadId: string, events: PiEvent[]): void {
    this.broadcast(threadId, { v, type: "events", threadId, events });
  }

  changed(thread: LiveThread, reset = false): void {
    for (const [id, peer] of this.peers) {
      if (peer.thread !== thread) continue;
      if (reset) {
        peer.historyAbort?.abort();
        peer.history = undefined;
        peer.generation++;
        this.snapshot(id, peer);
      } else this.send(id, { v, type: "status", thread: this.options.describe(thread) });
    }
  }

  uiChanged(thread: LiveThread): void {
    this.broadcast(thread.id, { v, type: "extension-ui", threadId: thread.id, ui: thread.ui });
  }

  closed(thread: LiveThread): void {
    for (const [id, peer] of this.peers) {
      if (peer.thread !== thread) continue;
      peer.unobserve?.();
      peer.historyAbort?.abort();
      peer.thread = undefined;
      peer.history = undefined;
      peer.generation++;
      this.send(id, {
        v,
        type: "snapshot",
        thread: null,
        state: threadFromMessages([]),
        draft: "",
        images: [],
        ui: NO_EXTENSION_UI,
      });
    }
  }

  sidebar(projects: SidebarProject[]): void {
    for (const id of this.peers.keys()) this.send(id, { v, type: "sidebar", projects });
  }

  private broadcast(threadId: string, message: HostMessage): void {
    for (const [id, peer] of this.peers) if (peer.thread?.id === threadId) this.send(id, message);
  }

  private disconnect(id: string): void {
    const peer = this.peers.get(id);
    if (peer?.thread) peer.thread.lastUsed = Date.now();
    peer?.unobserve?.();
    peer?.historyAbort?.abort();
    if (peer) {
      peer.history = undefined;
      peer.thread = undefined;
      peer.queue.length = 0;
      peer.queuedBytes = 0;
      peer.generation++;
    }
    this.peers.delete(id);
    this.options.checkPool();
  }

  private send(clientId: string, message: HostMessage): void {
    const peer = this.peers.get(clientId);
    if (!peer) return;
    const bytes = remotePayloadBytes(message);
    if (bytes === null) {
      this.post({
        type: "close",
        clientId,
        reason: "Remote content is too large or complex; view it on your Mac",
      });
      this.disconnect(clientId);
      return;
    }
    // Credit-based delivery also bounds the host/gateway MessagePort, not just WebSocket buffers.
    // Lifecycle/status bursts are normal even on a fast connection. Bound
    // retained bytes as well as count instead of treating a short burst as a slow phone.
    if (peer.queue.length >= 64 || peer.queuedBytes + bytes > REMOTE_FRAME_BYTES) {
      this.post({ type: "close", clientId, reason: "Remote client is too slow; reconnect" });
      this.disconnect(clientId);
      return;
    }
    peer.queue.push({ message, bytes });
    peer.queuedBytes += bytes;
    this.pump(clientId, peer);
  }

  private pump(clientId: string, peer: Peer): void {
    if (peer.busy) return;
    const next = peer.queue.shift();
    if (!next) return;
    peer.queuedBytes -= next.bytes;
    peer.busy = true;
    this.post({ type: "message", clientId, message: next.message });
  }

  private open(clientId: string, peer: Peer, id: string): void {
    const thread = this.options.thread(id);
    if (peer.thread === thread) return;
    if (peer.thread) peer.thread.lastUsed = Date.now();
    peer.unobserve?.();
    peer.historyAbort?.abort();
    peer.thread = undefined;
    peer.history = undefined;
    peer.generation++;
    // Flush existing subscribers before the new subscriber takes its baseline.
    const state = thread.remoteSnapshot();
    peer.thread = thread;
    thread.lastUsed = Date.now();
    peer.unobserve = thread.observeRemote();
    this.sendSnapshot(clientId, peer, state);
    this.options.checkPool();
  }

  private snapshot(clientId: string, peer: Peer): void {
    if (peer.thread) this.sendSnapshot(clientId, peer, peer.thread.remoteSnapshot());
  }

  private sendSnapshot(clientId: string, peer: Peer, state: ThreadState): void {
    const thread = peer.thread;
    if (!thread) return;
    const omitted = Math.max(0, state.messages.length - REMOTE_RECENT_MESSAGES);
    // pi's leading compaction summary is synthetic: it isn't a saved message entry.
    peer.omittedMessages =
      omitted - (omitted > 0 && state.messages[0]?.role === "compactionSummary" ? 1 : 0);
    this.send(clientId, {
      v,
      type: "snapshot",
      historyOmitted: omitted > 0,
      thread: this.options.describe(thread),
      state: { ...state, messages: state.messages.slice(-REMOTE_RECENT_MESSAGES) },
      draft: "",
      images: [],
      ui: thread.ui,
    });
  }

  private async request(clientId: string, peer: Peer, message: ClientMessage): Promise<void> {
    if (message.type === "ping") {
      this.send(clientId, { v, type: "pong", id: message.id });
      return;
    }
    if (message.type === "open-thread") {
      this.open(clientId, peer, message.threadId);
      return;
    }
    if (message.type === "new-thread") {
      this.open(clientId, peer, this.options.newThread(message.projectId));
      this.sidebar(this.options.sidebar());
      return;
    }
    if (!("threadId" in message) || message.threadId !== peer.thread?.id)
      throw new Error("Open that thread on this device first.");
    const thread = peer.thread;
    switch (message.type) {
      case "prompt":
        await this.options.prompt(message);
        break;
      case "set-model":
        await thread.setModel(message.provider, message.modelId);
        break;
      case "set-thinking-level":
        await thread.setThinkingLevel(message.level);
        break;
      case "stop":
        await thread.stop();
        break;
      case "answer":
        thread.answer(message.dialogId, message.answer);
        break;
      case "list-checkpoints":
        this.send(clientId, {
          v,
          type: "checkpoints",
          threadId: thread.id,
          turns: await thread.checkpoints.list(),
          shared: true,
          unavailable: null,
        });
        break;
      case "read-checkpoint":
        this.send(clientId, {
          v,
          type: "checkpoint-diff",
          threadId: thread.id,
          id: message.id,
          turn: message.turn,
          diff: await thread.checkpoints.diff(message.turn),
        });
        break;
      case "history-index":
      case "history-preview":
      case "history-page":
        await this.history(clientId, peer, thread, message);
        break;
    }
  }

  private async history(
    clientId: string,
    peer: Peer,
    thread: LiveThread,
    message: Extract<ClientMessage, { type: "history-index" | "history-page" | "history-preview" }>,
  ): Promise<void> {
    const generation = peer.generation;
    try {
      if (message.type === "history-index") {
        if (!thread.sessionFile) throw new Error("This thread has no saved history yet.");
        peer.historyAbort?.abort();
        const controller = new AbortController();
        peer.historyAbort = controller;
        peer.history = undefined;
        const history = await SessionHistory.read(
          thread.sessionFile,
          thread.id,
          controller.signal,
          peer.omittedMessages,
        );
        if (
          controller.signal.aborted ||
          peer.generation !== generation ||
          !this.peers.has(clientId)
        )
          return;
        peer.history = history;
        this.send(clientId, {
          v,
          type: "history-result",
          threadId: thread.id,
          id: message.id,
          result: { kind: "index", index: history.index },
          error: null,
        });
      } else {
        const history = peer.history;
        if (!history || history.revision !== message.revision)
          throw new Error("Saved history changed. Reload history and try again.");
        const result =
          message.type === "history-page"
            ? { kind: "page" as const, page: await history.page(message.entryId) }
            : { kind: "preview" as const, preview: await history.preview(message.entryId) };
        if (peer.generation === generation)
          this.send(clientId, {
            v,
            type: "history-result",
            threadId: thread.id,
            id: message.id,
            result,
            error: null,
          });
      }
    } catch (error) {
      this.send(clientId, {
        v,
        type: "history-result",
        threadId: thread.id,
        id: message.id,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
