import { describe, expect, test } from "vitest";
import type { AssistantMessage, PiMessage, ToolResultMessage } from "../../shared/thread";
import type { ToolCall } from "../tools/model";
import {
  checkpointTurnAt,
  rowAt,
  streamingRowStart,
  timelineRows,
  turnChanges,
  turnStack,
} from "./turns";

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function call(name: string, args: ToolCall["arguments"], id = `call_${name}`): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function assistant(
  content: AssistantMessage["content"],
  { timestamp = 0, stopReason = "stop" as AssistantMessage["stopReason"] } = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: { ...NO_TOKENS, totalTokens: 0, cost: { ...NO_TOKENS, total: 0 } },
    stopReason,
    timestamp,
  };
}

function result(
  id: string,
  text: string,
  { isError = false, details }: { isError?: boolean; details?: { patch: string } } = {},
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
    timestamp: 0,
    ...(details === undefined ? {} : { details }),
  };
}

function user(text: string, timestamp = 0): PiMessage {
  return { role: "user", content: text, timestamp };
}

const text = (value: string) => ({ type: "text" as const, text: value });

describe("timelineRows", () => {
  test("a turn runs from an assistant message to the next user message, results included", () => {
    const messages: PiMessage[] = [
      user("Go."),
      assistant([call("bash", { command: "ls" }, "a"), call("read", { path: "x" }, "b")]),
      result("a", "x"),
      result("b", "contents"),
      assistant([text("Done.")]),
      user("More."),
      assistant([text("Sure.")]),
    ];

    const rows = timelineRows(messages);
    expect(rows.map((row) => [row.kind, row.start, row.end])).toEqual([
      ["user", 0, 1],
      ["assistant", 1, 5],
      ["user", 5, 6],
      ["assistant", 6, 7],
    ]);
    const turn = rows[1];
    expect(turn?.kind === "assistant" && turn.messages).toEqual([messages[1], messages[4]]);
    expect(rowAt(messages, 6)).toBe(rows[3]);
    expect(rowAt(messages, 2)).toBeUndefined();
  });

  test("a result whose call isn't in the transcript keeps its row", () => {
    const messages = [user("Go."), result("gone", "output"), assistant([text("Hm.")])];
    expect(timelineRows(messages).map((row) => [row.kind, row.start])).toEqual([
      ["user", 0],
      ["toolResult", 1],
      ["assistant", 2],
    ]);
  });

  test("rows keep their objects as messages are appended, until one joins them", () => {
    const first = [user("Go."), assistant([call("bash", {}, "a")])];
    const before = timelineRows(first);
    const grown = [...first, result("a", "x"), assistant([text("Done.")]), user("Next.")];
    const after = timelineRows(grown);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.end).toBe(4);
    expect(timelineRows(grown)).toBe(after);
    // A row nothing was added to keeps its object again.
    expect(timelineRows([...grown, assistant([text("Ok.")])])[1]).toBe(after[1]);
  });
});

test("visible context messages keep transcript order without exposing hidden extension or system messages", () => {
  const messages: PiMessage[] = [
    user("Go."),
    assistant([text("Before.")]),
    { role: "custom", customType: "notice", content: "Visible", display: true, timestamp: 1 },
    { role: "custom", customType: "private", content: "Hidden", display: false, timestamp: 2 },
    {
      role: "bashExecution",
      command: "pwd",
      output: "/checkout",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 3,
    },
    { role: "compactionSummary", summary: "Compacted", tokensBefore: 100, timestamp: 4 },
    { role: "branchSummary", summary: "Branch context", fromId: null, timestamp: 5 },
    assistant([text("After.")]),
  ];
  const rows = timelineRows(messages);
  expect(rows.map((row) => [row.kind, row.start, row.end])).toEqual([
    ["user", 0, 1],
    ["assistant", 1, 2],
    ["context", 2, 3],
    ["context", 4, 5],
    ["context", 5, 6],
    ["context", 6, 7],
    ["assistant", 7, 8],
  ]);
  const appended = timelineRows([...messages, user("Next.")]);
  for (let index = 0; index < rows.length - 1; index++) expect(appended[index]).toBe(rows[index]);
  expect(streamingRowStart(messages.slice(0, 7), assistant([text("Now.")]))).toBe(7);
  expect(
    timelineRows([{ role: "system", content: "Private system prompt", timestamp: 0 }]),
  ).toEqual([]);
});

describe("streamingRowStart", () => {
  const reply = assistant([text("")]);

  test("a reply that continues a turn shows in that turn's row", () => {
    const messages = [user("Go."), assistant([call("bash", {}, "a")]), result("a", "x")];
    expect(streamingRowStart(messages, reply)).toBe(1);
  });

  test("a reply to a prompt starts a new row after it", () => {
    expect(streamingRowStart([user("Go.")], reply)).toBe(1);
    expect(streamingRowStart([], reply)).toBe(0);
    expect(streamingRowStart([user("Go.")], null)).toBeNull();
  });
});

describe("turnStack", () => {
  test("groups a run of tool calls across messages into one work log", () => {
    const first = assistant(
      [{ type: "thinking", thinking: "Hm." }, text("Looking."), call("ls", {}, "a")],
      { timestamp: 1_000 },
    );
    const second = assistant([call("read", { path: "x" }, "b")], { timestamp: 2_000 });
    const third = assistant([text("Done.")]);

    const items = turnStack([first, second, third], null);
    expect(items.map((item) => item.kind)).toEqual(["thought", "text", "workLog", "text"]);
    const log = items[2];
    expect(log?.kind === "workLog" && log).toMatchObject({
      key: "a",
      startedAt: 1_000,
      calls: [
        { call: first.content[2], writing: false },
        { call: second.content[0], writing: false },
      ],
    });
  });

  test("text between calls splits the log, and a failed message adds its error", () => {
    const message = assistant([call("ls", {}, "a"), text("Now:"), call("ls", {}, "b")], {
      stopReason: "error",
    });
    const items = turnStack([{ ...message, errorMessage: "boom" }], null);
    expect(items.map((item) => item.kind)).toEqual(["workLog", "text", "workLog", "error"]);
    expect(items[3]).toMatchObject({ text: "boom" });
  });

  test("empty and whitespace-only thoughts stay out of the stack, including while streaming", () => {
    const empty = assistant([
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: " \n\t " },
    ]);
    expect(turnStack([empty], null)).toEqual([]);
    expect(turnStack([], empty)).toEqual([]);
    const first = assistant([call("read", {}, "a"), { type: "thinking", thinking: "" }]);
    const second = assistant([{ type: "thinking", thinking: " " }, call("read", {}, "b")]);
    expect(turnStack([first, second], null)).toMatchObject([
      { kind: "workLog", calls: [{ call: { id: "a" } }, { call: { id: "b" } }] },
    ]);
    expect(
      turnStack([empty], assistant([{ type: "thinking", thinking: "Real thought" }])),
    ).toMatchObject([{ kind: "thought", key: "1:0", text: "Real thought", active: true }]);
  });

  test("the message pi is writing joins the stack, its calls marked as being written", () => {
    const finished = assistant([call("ls", {}, "a")]);
    const streaming = assistant([
      call("read", {}, "b"),
      { type: "thinking", thinking: "Reading." },
    ]);
    const items = turnStack([finished], streaming);

    expect(items.map((item) => item.kind)).toEqual(["workLog", "thought"]);
    expect(items[0]).toMatchObject({
      calls: [
        { call: finished.content[0], writing: false },
        { call: streaming.content[0], writing: true },
      ],
    });
    expect(items[1]).toMatchObject({ key: "1:1", active: true });
    // The finished message keeps the key the streaming one had.
    expect(turnStack([finished, streaming], null)[1]?.key).toBe("1:1");
  });
});

describe("turnChanges", () => {
  const patch = "--- a\n+++ a\n@@ -1 +1,2 @@\n-x\n+y\n+z\n";
  const turn = [
    assistant([
      call("edit", { path: "a.ts" }, "e"),
      call("write", { path: "b.ts", content: "1\n2\n3\n" }, "w"),
      call("edit", { path: "c.ts" }, "failed"),
      call("read", { path: "a.ts" }, "r"),
    ]),
  ];

  test("counts the files edits and writes changed, and their lines", () => {
    const messages: PiMessage[] = [
      user("Go."),
      ...turn,
      result("e", "ok", { details: { patch } }),
      result("w", "ok"),
      result("failed", "no such file", { isError: true }),
      result("r", "contents"),
    ];
    const changes = turnChanges(turn, messages);
    expect(changes).toEqual({ files: 2, additions: 5, deletions: 1 });
    // The same counts keep the same object, so a selector returning them stays quiet.
    expect(turnChanges(turn, [...messages, assistant([text("Done.")])])).toBe(changes);
  });

  test("is null for a turn that changed nothing", () => {
    expect(turnChanges([assistant([text("Hi.")])], [user("Go.")])).toBeNull();
    expect(turnChanges(turn, [user("Go."), ...turn])).toBeNull();
  });
});

describe("checkpointTurnAt", () => {
  const turns = [
    { turn: 1, startedAt: 1_000 },
    { turn: 2, startedAt: 5_000 },
  ];

  test("finds the turn running when a message was stamped", () => {
    expect(checkpointTurnAt(turns, 1_200)).toBe(1);
    expect(checkpointTurnAt(turns, 5_000)).toBe(2);
    expect(checkpointTurnAt(turns, 9_000)).toBe(2);
  });

  test("finds nothing before the first turn or without a stamp", () => {
    expect(checkpointTurnAt(turns, 500)).toBeUndefined();
    expect(checkpointTurnAt(turns, undefined)).toBeUndefined();
    expect(checkpointTurnAt([], 1_200)).toBeUndefined();
  });
});
