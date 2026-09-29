// The thread reducer: pi's session events in, the state a timeline renders out.
// The host runs it for every open thread, and the renderer runs it on the
// batches it receives, so both hold the same state.
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** A session event as pi writes it to stdout in RPC mode. */
export type PiEvent = JsonAgentSessionEvent;
/** A transcript message, as get_messages and message_end carry it. */
export type PiMessage = Extract<PiEvent, { type: "message_end" }>["message"];
export type AssistantMessage = Extract<PiMessage, { role: "assistant" }>;
export type ToolResultMessage = Extract<PiMessage, { role: "toolResult" }>;
type AssistantUpdate = Extract<PiEvent, { type: "message_update" }>["assistantMessageEvent"];
type ContentBlock = AssistantMessage["content"][number];

/** What a tool returns: text and images for the model, and details for a UI. */
export interface ToolOutput {
  readonly content: ToolResultMessage["content"];
  /** Tool-specific. edit's holds its patch. */
  readonly details?: unknown;
}

/**
 * A tool call pi is running, from tool_execution_start until its result
 * message arrives. pi runs a reply's tool calls at the same time and sends
 * their result messages in call order, so a finished call can wait for a
 * slower one before it.
 */
export interface ToolRun {
  /**
   * The tool's latest partial result. Each one replaces the one before, as in
   * pi's own terminal UI. bash sends all of its output so far.
   */
  readonly partial: ToolOutput | null;
  /** The result from tool_execution_end, until the result message takes over. */
  readonly result: ToolOutput | null;
  readonly isError: boolean;
}

/** The messages you sent while pi was working, which pi hasn't taken yet. */
export interface Queue {
  /** Sent with Enter. pi takes them as soon as its current step is done. */
  readonly steering: readonly string[];
  /** Sent with Alt+Enter. pi takes them once it would otherwise stop. */
  readonly followUp: readonly string[];
}

/** A failed request pi is about to retry, as auto_retry_start describes it. */
export type Retry = Omit<Extract<PiEvent, { type: "auto_retry_start" }>, "type">;
export type CompactionReason = Extract<PiEvent, { type: "compaction_start" }>["reason"];

export interface ThreadState {
  /** Finished messages in transcript order, without pi's system prompt. */
  readonly messages: readonly PiMessage[];
  /** The assistant message pi is writing, built from deltas. */
  readonly streaming: AssistantMessage | null;
  /** True from agent_start until agent_settled. */
  readonly running: boolean;
  /** What pi's last queue_update listed. */
  readonly queue: Queue;
  /** Set from auto_retry_start until auto_retry_end. */
  readonly retry: Retry | null;
  /** Set from compaction_start until compaction_end. */
  readonly compaction: CompactionReason | null;
  /** The tool calls pi is running, by tool call id. */
  readonly tools: Readonly<Record<string, ToolRun>>;
}

const NOTHING_QUEUED: Queue = { steering: [], followUp: [] };
const NO_TOOLS: Readonly<Record<string, ToolRun>> = {};

/** A thread opened from a get_messages transcript. */
export function threadFromMessages(messages: readonly PiMessage[]): ThreadState {
  return {
    messages: messages.filter((message) => message.role !== "system"),
    streaming: null,
    running: false,
    queue: NOTHING_QUEUED,
    retry: null,
    compaction: null,
    tools: NO_TOOLS,
  };
}

/**
 * Returns the thread after `event`. Events that change nothing return the
 * same object, so a subscriber can compare references to skip a render.
 */
export function applyEvent(thread: ThreadState, event: PiEvent): ThreadState {
  switch (event.type) {
    case "agent_start":
      return thread.running ? thread : { ...thread, running: true };
    case "agent_settled":
      // pi won't run anything more, so a call still listed will never finish.
      return thread.running || thread.tools !== NO_TOOLS
        ? { ...thread, running: false, tools: NO_TOOLS }
        : thread;
    case "message_start":
      return event.message.role === "assistant" ? { ...thread, streaming: event.message } : thread;
    case "message_update": {
      if (!thread.streaming) return thread;
      const streaming = applyUpdate(thread.streaming, event.assistantMessageEvent);
      return streaming === thread.streaming ? thread : { ...thread, streaming };
    }
    case "message_end": {
      // message_end carries the whole message, so it replaces what the deltas built.
      const message = event.message;
      if (message.role === "system") return thread;
      return {
        ...thread,
        messages: [...thread.messages, message],
        streaming: message.role === "assistant" ? null : thread.streaming,
        tools:
          message.role === "toolResult" ? without(thread.tools, message.toolCallId) : thread.tools,
      };
    }
    case "tool_execution_start":
      return withRun(thread, event.toolCallId, { partial: null, result: null, isError: false });
    case "tool_execution_update": {
      const run = toolRun(thread, event.toolCallId);
      if (!run) return thread;
      return withRun(thread, event.toolCallId, {
        ...run,
        partial: toolOutput(event.partialResult),
      });
    }
    case "tool_execution_end": {
      const run = toolRun(thread, event.toolCallId);
      if (!run) return thread;
      const result = toolOutput(event.result);
      return withRun(thread, event.toolCallId, { ...run, result, isError: event.isError });
    }
    case "queue_update": {
      const { steering, followUp } = event;
      const unchanged =
        sameTexts(steering, thread.queue.steering) && sameTexts(followUp, thread.queue.followUp);
      return unchanged ? thread : { ...thread, queue: { steering, followUp } };
    }
    case "auto_retry_start": {
      const { attempt, maxAttempts, delayMs, errorMessage } = event;
      return { ...thread, retry: { attempt, maxAttempts, delayMs, errorMessage } };
    }
    case "auto_retry_end":
      return thread.retry ? { ...thread, retry: null } : thread;
    case "compaction_start":
      return thread.compaction === event.reason ? thread : { ...thread, compaction: event.reason };
    case "compaction_end":
      return thread.compaction ? { ...thread, compaction: null } : thread;
    default:
      return thread;
  }
}

/** The run of tool call `id`. Ids come from the model, so an id like "constructor" finds nothing. */
export function toolRun(thread: ThreadState, id: string): ToolRun | undefined {
  return Object.hasOwn(thread.tools, id) ? thread.tools[id] : undefined;
}

function withRun(thread: ThreadState, id: string, run: ToolRun): ThreadState {
  return { ...thread, tools: { ...thread.tools, [id]: run } };
}

function without(
  tools: Readonly<Record<string, ToolRun>>,
  id: string,
): Readonly<Record<string, ToolRun>> {
  if (!Object.hasOwn(tools, id)) return tools;
  const { [id]: _finished, ...rest } = tools;
  return Object.keys(rest).length === 0 ? NO_TOOLS : rest;
}

/** pi types tool results as `any`, and extensions' tools can send anything. */
function toolOutput(value: unknown): ToolOutput {
  if (typeof value !== "object" || value === null) return { content: [] };
  const { content, details } = value as { content?: unknown; details?: unknown };
  return {
    content: Array.isArray(content) ? (content as ToolOutput["content"]) : [],
    ...(details === undefined ? {} : { details }),
  };
}

function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((text, index) => text === b[index]);
}

/**
 * The thread once its pi has exited. The finished messages stay. The reply pi
 * was writing goes, since pi saves a message only when it ends, and so does
 * everything else that needed a running pi.
 */
export function afterPiExit(thread: ThreadState): ThreadState {
  return { ...threadFromMessages([]), messages: thread.messages };
}

export function applyEvents(thread: ThreadState, events: readonly PiEvent[]): ThreadState {
  let next = thread;
  for (const event of events) next = applyEvent(next, event);
  return next;
}

function applyUpdate(message: AssistantMessage, update: AssistantUpdate): AssistantMessage {
  const index = "contentIndex" in update ? update.contentIndex : -1;
  const block = message.content[index];
  switch (update.type) {
    case "text_start":
      return withBlock(message, index, { type: "text", text: "" });
    case "text_delta":
      return block?.type === "text"
        ? withBlock(message, index, { ...block, text: block.text + update.delta })
        : message;
    case "text_end":
      // The *_end content is authoritative over the deltas that came before it.
      return withBlock(message, index, { type: "text", text: update.content });
    case "thinking_start":
      return withBlock(message, index, { type: "thinking", thinking: "" });
    case "thinking_delta":
      return block?.type === "thinking"
        ? withBlock(message, index, { ...block, thinking: block.thinking + update.delta })
        : message;
    case "thinking_end":
      return withBlock(message, index, { type: "thinking", thinking: update.content });
    case "toolcall_start":
      // The arguments stream as partial JSON. The timeline shows them once
      // toolcall_end brings the parsed call.
      return withBlock(message, index, {
        type: "toolCall",
        id: update.id,
        name: update.toolName,
        arguments: {},
      });
    case "toolcall_end":
      return withBlock(message, index, update.toolCall);
    default:
      return message;
  }
}

function withBlock(
  message: AssistantMessage,
  index: number,
  block: ContentBlock,
): AssistantMessage {
  const content = message.content.slice();
  content[index] = block;
  return { ...message, content };
}
