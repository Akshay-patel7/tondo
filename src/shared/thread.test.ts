import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseFixture } from "./fixture";
import {
  afterPiExit,
  applyEvent,
  applyEvents,
  threadFromMessages,
  toolRun,
  type AssistantMessage,
  type PiEvent,
  type PiMessage,
  type ThreadState,
  type ToolResultMessage,
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
      // Updates and ends for a call that never started.
      {
        type: "tool_execution_update",
        toolCallId: "call_1",
        toolName: "bash",
        args: {},
        partialResult: { content: [] },
      },
      {
        type: "tool_execution_end",
        toolCallId: "constructor",
        toolName: "bash",
        result: { content: [] },
        isError: false,
      },
      { type: "message_start", message: prompt! },
      { type: "agent_settled" },
      { type: "auto_retry_end", success: true, attempt: 1 },
      {
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted: true,
        willRetry: false,
      },
    ];
    for (const event of unchanged) expect(applyEvent(empty, event)).toBe(empty);
  });

  test("a delta with no streaming message is ignored", () => {
    const delta = fixture("stream-1000.jsonl").find((event) => event.type === "message_update");
    expect(applyEvent(empty, delta!)).toBe(empty);
  });

  test("queue_update replaces the queue, and the same queue again changes nothing", () => {
    const update: PiEvent = {
      type: "queue_update",
      steering: ["look at the tests first"],
      followUp: ["then commit"],
    };
    const queued = applyEvent(empty, update);

    expect(queued.queue).toEqual({
      steering: ["look at the tests first"],
      followUp: ["then commit"],
    });
    expect(applyEvent(queued, { ...update })).toBe(queued);
    const drained = applyEvent(queued, { type: "queue_update", steering: [], followUp: [] });
    expect(drained.queue).toEqual({ steering: [], followUp: [] });
  });

  test("a retry shows from auto_retry_start until auto_retry_end", () => {
    const retrying = applyEvent(empty, {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "503 Service Unavailable",
    });

    expect(retrying.retry).toEqual({
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "503 Service Unavailable",
    });
    const ended = applyEvent(retrying, { type: "auto_retry_end", success: true, attempt: 1 });
    expect(ended.retry).toBeNull();
  });

  test("compaction shows from compaction_start until compaction_end", () => {
    const compacting = applyEvent(empty, { type: "compaction_start", reason: "threshold" });

    expect(compacting.compaction).toBe("threshold");
    const ended = applyEvent(compacting, {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "The summary request failed",
    });
    expect(ended.compaction).toBeNull();
  });
});

const start = (id: string): PiEvent => ({
  type: "tool_execution_start",
  toolCallId: id,
  toolName: "bash",
  args: { command: "make" },
});
const update = (id: string, partialResult: unknown): PiEvent => ({
  type: "tool_execution_update",
  toolCallId: id,
  toolName: "bash",
  args: { command: "make" },
  partialResult,
});
const end = (id: string, printed: string, isError = false): PiEvent => ({
  type: "tool_execution_end",
  toolCallId: id,
  toolName: "bash",
  result: { content: [{ type: "text", text: printed }] },
  isError,
});
function resultMessage(id: string, printed: string): PiEvent {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: id,
    toolName: "bash",
    content: [{ type: "text", text: printed }],
    isError: false,
    timestamp: 0,
  };
  return { type: "message_end", message };
}
const output = (printed: string) => ({ content: [{ type: "text", text: printed }] });

describe("tool calls", () => {
  test("a call runs from tool_execution_start until its result message", () => {
    const events = fixture("tools.jsonl");
    const index = (type: string) => events.findIndex((event) => event.type === type);
    const at = (type: string) => applyEvents(empty, events.slice(0, index(type) + 1));

    expect(toolRun(at("tool_execution_start"), "call_tools_1")).toEqual({
      partial: null,
      result: null,
      isError: false,
    });
    const listing = "src/buffer.ts\nsrc/stream.ts\nsrc/parser.ts\nsrc/stream.ts\nsrc/parser.ts\n";
    expect(toolRun(at("tool_execution_end"), "call_tools_1")).toEqual({
      partial: { content: [{ type: "text", text: listing }], details: {} },
      result: output(listing),
      isError: false,
    });
    const done = applyEvents(empty, events);
    expect(done.tools).toEqual({});
    expect(done.messages.find((message) => message.role === "toolResult")).toMatchObject({
      toolCallId: "call_tools_1",
      content: [{ type: "text", text: listing }],
    });
  });

  test("each partial result replaces the one before", () => {
    const running = applyEvents(empty, [
      start("call_1"),
      update("call_1", output("line 1\n")),
      update("call_1", output("line 1\nline 2\n")),
    ]);

    expect(toolRun(running, "call_1")?.partial).toEqual(output("line 1\nline 2\n"));
  });

  test("a partial result that isn't a tool result counts as empty", () => {
    const running = applyEvents(empty, [
      start("call_1"),
      update("call_1", "not an object"),
      update("call_2", output("never started")),
    ]);

    expect(toolRun(running, "call_1")?.partial).toEqual({ content: [] });
    expect(toolRun(running, "call_2")).toBeUndefined();
  });

  test("a finished call keeps its result while its message waits for an earlier call", () => {
    // pi runs both calls at once, and sends their result messages in call order.
    const bothRan = applyEvents(empty, [start("slow"), start("quick"), end("quick", "done")]);

    expect(toolRun(bothRan, "slow")).toEqual({ partial: null, result: null, isError: false });
    expect(toolRun(bothRan, "quick")).toEqual({
      partial: null,
      result: output("done"),
      isError: false,
    });
    const slowDone = applyEvents(bothRan, [end("slow", "failed", true), resultMessage("slow", "")]);
    expect(Object.keys(slowDone.tools)).toEqual(["quick"]);
    expect(applyEvent(slowDone, resultMessage("quick", "done")).tools).toEqual({});
  });

  test("agent_settled drops calls that never got a result", () => {
    const settled = applyEvents(empty, [
      { type: "agent_start" },
      start("call_1"),
      { type: "agent_settled" },
    ]);

    expect(settled.tools).toEqual({});
    expect(settled.running).toBe(false);
  });

  test("an id the model made up can't reach the prototype", () => {
    const thread = applyEvents(empty, [start("__proto__"), update("__proto__", output("x"))]);

    expect(toolRun(thread, "__proto__")?.partial).toEqual(output("x"));
    expect(toolRun(thread, "toString")).toBeUndefined();
    expect(Object.getPrototypeOf(thread.tools)).toBe(Object.prototype);
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

describe("afterPiExit", () => {
  test("keeps the finished messages and drops what needed a running pi", () => {
    const events = fixture("stream-1000.jsonl");
    const firstDelta = events.findIndex((event) => event.type === "message_update");
    const midStream = applyEvents(empty, [
      ...events.slice(0, firstDelta + 1),
      { type: "queue_update", steering: ["stop there"], followUp: [] },
      { type: "compaction_start", reason: "overflow" },
    ]);
    expect(midStream.streaming).not.toBeNull();
    expect(midStream.running).toBe(true);

    expect(afterPiExit(midStream)).toEqual({
      ...empty,
      messages: midStream.messages,
    });
    expect(midStream.messages.length).toBeGreaterThan(0);
  });
});
