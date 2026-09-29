import { describe, expect, test } from "vitest";
import type { AssistantMessage, PiMessage, ToolResultMessage, ToolRun } from "../../shared/thread";
import {
  callOutput,
  callStatus,
  editPatch,
  lastLines,
  MAX_SUBJECT_CHARS,
  outputText,
  patchStats,
  readsFromStart,
  splitReadNote,
  summarizeCall,
  timelineRows,
  toolResults,
  type ToolCall,
} from "./model";

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function call(name: string, args: ToolCall["arguments"], id = `call_${name}`): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function assistant(...content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: { ...NO_TOKENS, totalTokens: 0, cost: { ...NO_TOKENS, total: 0 } },
    stopReason: "toolUse",
    timestamp: 0,
  };
}

function result(id: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
    timestamp: 0,
  };
}

const user: PiMessage = { role: "user", content: "Go.", timestamp: 0 };

describe("timelineRows", () => {
  test("a result shows in its call's card, not as a row", () => {
    const messages: PiMessage[] = [
      user,
      assistant(call("bash", { command: "ls" }, "a"), call("read", { path: "x" }, "b")),
      result("a", "x"),
      result("b", "contents"),
      assistant({ type: "text", text: "Done." }),
    ];

    expect(timelineRows(messages)).toEqual([0, 1, 4]);
  });

  test("a result whose call isn't in the transcript keeps its row", () => {
    expect(timelineRows([user, result("gone", "output")])).toEqual([0, 1]);
  });
});

describe("toolResults", () => {
  test("finds each result by its call's id, once per messages array", () => {
    const messages = [user, assistant(call("bash", {}, "a")), result("a", "out")];
    const index = toolResults(messages);

    expect(index.get("a")).toBe(messages[2]);
    expect(index.get("constructor")).toBeUndefined();
    expect(toolResults(messages)).toBe(index);
  });
});

describe("callStatus", () => {
  const running: ToolRun = { partial: null, result: null, isError: false };
  const base = { writing: false, result: undefined, run: undefined, piWorking: true };

  test("follows the call from the model writing it to its result", () => {
    expect(callStatus({ ...base, writing: true })).toBe("writing");
    expect(callStatus(base)).toBe("waiting");
    expect(callStatus({ ...base, run: running })).toBe("running");
    const ended = { ...running, result: { content: [] } };
    expect(callStatus({ ...base, run: ended })).toBe("done");
    expect(callStatus({ ...base, run: { ...ended, isError: true } })).toBe("failed");
    expect(callStatus({ ...base, result: result("a", "out") })).toBe("done");
    expect(callStatus({ ...base, result: result("a", "boom", true) })).toBe("failed");
  });

  test("a call pi never finished shows as stopped once pi is idle", () => {
    expect(callStatus({ ...base, piWorking: false })).toBe("stopped");
  });
});

describe("callOutput", () => {
  test("prefers the result message, then the ended run, then the latest partial", () => {
    const partial = { content: [{ type: "text" as const, text: "so far" }] };
    const ended = { content: [{ type: "text" as const, text: "all" }] };
    const message = result("a", "final");

    expect(callOutput(undefined, undefined)).toBeNull();
    expect(callOutput(undefined, { partial, result: null, isError: false })).toBe(partial);
    expect(callOutput(undefined, { partial, result: ended, isError: false })).toBe(ended);
    expect(callOutput(message, { partial, result: ended, isError: false })).toBe(message);
  });
});

describe("outputText and lastLines", () => {
  test("images become placeholders", () => {
    expect(
      outputText([
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ]),
    ).toBe("Read image file [image/png]\n[image: image/png]");
  });

  test("lastLines keeps the tail and ignores a final newline", () => {
    expect(lastLines("1\n2\n3\n4\n5\n6\n7\n", 5)).toBe("3\n4\n5\n6\n7");
    expect(lastLines("only", 5)).toBe("only");
  });
});

describe("patchStats", () => {
  test("counts pi's patch lines, not its file header", () => {
    // What pi 0.87.1's edit reports, from its generateUnifiedPatch.
    const patch =
      "--- src/a.ts\n+++ src/a.ts\n@@ -1,5 +1,5 @@\n---flag\n keep 1\n keep 2\n-old line\n+new line\n+another\n keep 3\n";

    expect(patchStats(patch)).toEqual({ additions: 2, deletions: 2 });
  });
});

describe("splitReadNote", () => {
  test("takes each of read's notes off the end", () => {
    for (const note of [
      "[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]",
      "[Showing lines 1-900 of 5000 (50KB limit). Use offset=901 to continue.]",
      "[120 more lines in file. Use offset=41 to continue.]",
    ]) {
      expect(splitReadNote(`a\nb\n\n${note}`)).toEqual({ body: "a\nb", note });
    }
  });

  test("leaves a whole file alone", () => {
    expect(splitReadNote("a\n\n[not a note]")).toEqual({ body: "a\n\n[not a note]", note: null });
  });
});

describe("summarizeCall", () => {
  test("names what each built-in tool works on", () => {
    expect(summarizeCall(call("bash", { command: "pnpm test" }))).toEqual({
      subject: "pnpm test",
      detail: null,
    });
    expect(summarizeCall(call("read", { path: "a.ts", offset: 10, limit: 5 }))).toEqual({
      subject: "a.ts",
      detail: "lines 10–14",
    });
    expect(summarizeCall(call("read", { path: "a.ts", offset: 10 })).detail).toBe("from line 10");
    expect(summarizeCall(call("write", { path: "b.ts", content: "x\ny\n" }))).toEqual({
      subject: "b.ts",
      detail: "2 lines",
    });
    expect(summarizeCall(call("grep", { pattern: "TODO", path: "src" }))).toEqual({
      subject: "TODO",
      detail: "in src",
    });
    expect(summarizeCall(call("ls", {}))).toEqual({ subject: ".", detail: null });
  });

  test("shows an extension tool's arguments as they are", () => {
    expect(summarizeCall(call("weather", { city: "Oslo" })).subject).toBe('{"city":"Oslo"}');
  });

  test("cuts a very long subject", () => {
    const { subject } = summarizeCall(call("bash", { command: "x".repeat(MAX_SUBJECT_CHARS + 1) }));
    expect(subject).toBe(`${"x".repeat(MAX_SUBJECT_CHARS)}…`);
  });

  test("ignores arguments of the wrong type", () => {
    expect(summarizeCall(call("read", { path: 7, offset: "10" }))).toEqual({
      subject: "",
      detail: null,
    });
  });
});

describe("editPatch and readsFromStart", () => {
  test("editPatch finds the patch in edit's details", () => {
    expect(editPatch({ diff: "x", patch: "--- a\n+++ a\n" })).toBe("--- a\n+++ a\n");
    expect(editPatch(undefined)).toBeUndefined();
    expect(editPatch({ patch: 5 })).toBeUndefined();
  });

  test("readsFromStart", () => {
    expect(readsFromStart(call("read", { path: "a" }))).toBe(true);
    expect(readsFromStart(call("read", { path: "a", offset: 1 }))).toBe(true);
    expect(readsFromStart(call("read", { path: "a", offset: 40 }))).toBe(false);
  });
});
