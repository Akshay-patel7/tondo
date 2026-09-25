// The thread reducer: pi's session events in, the state a timeline renders out.
// The host runs it for every open thread, and the renderer runs it on the
// batches it receives, so both hold the same state.
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** A session event as pi writes it to stdout in RPC mode. */
export type PiEvent = JsonAgentSessionEvent;
/** A transcript message, as get_messages and message_end carry it. */
export type PiMessage = Extract<PiEvent, { type: "message_end" }>["message"];
export type AssistantMessage = Extract<PiMessage, { role: "assistant" }>;
type AssistantUpdate = Extract<PiEvent, { type: "message_update" }>["assistantMessageEvent"];
type ContentBlock = AssistantMessage["content"][number];

export interface ThreadState {
  /** Finished messages in transcript order, without pi's system prompt. */
  readonly messages: readonly PiMessage[];
  /** The assistant message pi is writing, built from deltas. */
  readonly streaming: AssistantMessage | null;
  /** True from agent_start until agent_settled. */
  readonly running: boolean;
}

/** A thread opened from a get_messages transcript. */
export function threadFromMessages(messages: readonly PiMessage[]): ThreadState {
  return {
    messages: messages.filter((message) => message.role !== "system"),
    streaming: null,
    running: false,
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
      return thread.running ? { ...thread, running: false } : thread;
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
      };
    }
    default:
      return thread;
  }
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
