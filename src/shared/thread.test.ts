import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseFixture } from "./fixture";
import {
  applyEvent,
  applyEvents,
  threadFromMessages,
  type AssistantMessage,
  type PiEvent,
  type PiMessage,
  type ThreadState,
} from "./thread";

const fixturesDir = path.resolve(import.meta.dirname, "../../fixtures");

function fixture(name: string): PiEvent[] {
  const jsonl = readFileSync(path.join(fixturesDir, name), "utf8");
  return parseFixture(jsonl).map((entry) => entry.event);
}

/** The messages pi finished, from its message_end events, without the system prompt. */
function finished(events: PiEvent[]): PiMessage[] {
  return events.flatMap((event) =>
    event.type === "message_end" && event.message.role !== "system" ? [event.message] : [],
  );
}

function text(message: AssistantMessage | null): string {
  return (message?.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

const empty = threadFromMessages([]);

describe("applyEvent", () => {
  test("a streamed reply ends as the message pi finished with", () => {
    const events = fixture("stream-1000.jsonl");
    const thread = applyEvents(empty, events);

    expect(thread.messages).toEqual(finished(events));
    expect(thread.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(thread.streaming).toBeNull();
    expect(thread.running).toBe(false);
  });

  test("while text streams, only the streaming message changes", () => {
    const events = fixture("stream-1000.jsonl");
    let thread: ThreadState = empty;
    let streamed = "";
    let deltas = 0;

    for (const event of events) {
      const next = applyEvent(thread, event);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        streamed += event.assistantMessageEvent.delta;
        deltas++;
        expect(next.messages).toBe(thread.messages);
        expect(next.streaming).not.toBe(thread.streaming);
        expect(text(next.streaming)).toBe(streamed);
      }
      thread = next;
    }
    expect(deltas).toBeGreaterThan(5000);
    expect(thread.running).toBe(false);
  });

  test("text_end and thinking_end replace the text the deltas built", () => {
    // fixture() parses a fresh copy, so the deltas can be garbled in place.
    const events = fixture("tools.jsonl");
    for (const event of events) {
      if (event.type !== "message_update") continue;
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" || update.type === "thinking_delta")
        update.delta = "garbled ";
    }
    // Stop before the first message_end, which would replace the message anyway.
    const firstEnd = events.findIndex(
      (event) => event.type === "message_end" && event.message.role === "assistant",
    );
    const streaming = applyEvents(empty, events.slice(0, firstEnd)).streaming;
    const finalMessage = finished(events).find((message) => message.role === "assistant");

    expect(streaming?.content).toEqual((finalMessage as AssistantMessage).content);
  });

  test("message_end replaces the whole message", () => {
    const events = fixture("error.jsonl");
    const end = events.findIndex(
      (event) => event.type === "message_end" && event.message.role === "assistant",
    );
    const original = events[end] as Extract<PiEvent, { type: "message_end" }>;
    const replacement: AssistantMessage = {
      ...(original.message as AssistantMessage),
      content: [{ type: "text", text: "Only this survives." }],
    };
    events[end] = { type: "message_end", message: replacement };

    expect(applyEvents(empty, events).messages.at(-1)).toBe(replacement);
  });

  test("a tool turn keeps its thinking, text, tool call and result in order", () => {
    const events = fixture("tools.jsonl");
    const thread = applyEvents(empty, events);

    expect(thread.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    const call = thread.messages[1] as AssistantMessage;
    expect(call.content.map((block) => block.type)).toEqual(["thinking", "text", "toolCall"]);
    expect(call.content[2]).toMatchObject({ type: "toolCall", id: "call_tools_1", name: "bash" });
    expect(thread.messages).toEqual(finished(events));
  });

  test("the tool call shows as soon as it starts", () => {
    const events = fixture("tools.jsonl");
    const start = events.findIndex(
      (event) =>
        event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_start",
    );
    const streaming = applyEvents(empty, events.slice(0, start + 1)).streaming;

    expect(streaming?.content.at(-1)).toEqual({
      type: "toolCall",
      id: "call_tools_1",
      name: "bash",
      arguments: {},
    });
  });

  test("an error ends the reply with pi's error message", () => {
    const thread = applyEvents(empty, fixture("error.jsonl"));
    const reply = thread.messages.at(-1) as AssistantMessage;

    expect(reply.stopReason).toBe("error");
    expect(reply.errorMessage).toBe("Faux provider error: the request was rejected.");
    expect(thread.streaming).toBeNull();
    expect(thread.running).toBe(false);
  });

  test("an abort keeps the text streamed before it", () => {
    const events = fixture("abort.jsonl");
    const streamed = events
      .map((event) =>
        event.type === "message_update" && event.assistantMessageEvent.type === "text_delta"
          ? event.assistantMessageEvent.delta
          : "",
      )
      .join("");
    const thread = applyEvents(empty, events);
    const reply = thread.messages.at(-1) as AssistantMessage;

    expect(reply.stopReason).toBe("aborted");
    expect(text(reply)).toBe(streamed);
    expect(streamed.length).toBeGreaterThan(0);
    expect(thread.running).toBe(false);
  });

  test("events that change nothing return the same thread", () => {
    const [prompt] = finished(fixture("tools.jsonl"));
    const unchanged: PiEvent[] = [
      { type: "turn_start" },
      { type: "queue_update", steering: [], followUp: [] },
      { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: {} },
      { type: "message_start", message: prompt! },
      { type: "agent_settled" },
    ];
    for (const event of unchanged) expect(applyEvent(empty, event)).toBe(empty);
  });

  test("a delta with no streaming message is ignored", () => {
    const delta = fixture("stream-1000.jsonl").find((event) => event.type === "message_update");
    expect(applyEvent(empty, delta!)).toBe(empty);
  });
});

describe("threadFromMessages", () => {
  test("opens the 1,000-message transcript without pi's system prompt", () => {
    const { messages } = JSON.parse(
      readFileSync(path.join(fixturesDir, "transcript-1000.json"), "utf8"),
    ) as { messages: PiMessage[] };
    const thread = threadFromMessages(messages);

    expect(messages[0]?.role).toBe("system");
    expect(thread.messages).toHaveLength(1000);
    expect(thread.messages).toEqual(messages.slice(1));
    expect(thread.streaming).toBeNull();
  });
});
