import { describe, expect, test } from "vitest";
import type { AssistantMessage, PiMessage, ToolResultMessage, ToolRun } from "../../shared/thread";
import {
  callMeta,
  callOutput,
  callStatus,
  editPatch,
  formatDuration,
  lastLines,
  MAX_SUMMARY_CHARS,
  outputText,
  patchStats,
  readsFromStart,
  splitReadNote,
  summarizeCall,
  testVerdict,
  toolResults,
  workLogDuration,
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

function result(id: string, text: string, isError = false, timestamp = 0): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
    timestamp,
  };
}

const user: PiMessage = { role: "user", content: "Go.", timestamp: 0 };

/** A faint figure, as callMeta gives for counts. */
const faint = (text: string) => ({ kind: "text", text, tone: "faint" });

/** `output` as a finished call's result, for callMeta. */
function done(text: string) {
  return { status: "done" as const, output: { content: [{ type: "text" as const, text }] } };
}

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

  test("a command's colors don't show as escape codes", () => {
    const colored = "\u001B[31mRED\u001B[0m plain \u001B[1;32mGREEN\u001B[0m\n";
    expect(outputText([{ type: "text", text: colored }])).toBe("RED plain GREEN\n");
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
  test("puts the action and filename first, with the full path and requested range underneath", () => {
    expect(summarizeCall(call("read", { path: "src/a.ts", offset: 10, limit: 5 }))).toEqual({
      title: "Read a.ts",
      detail: "src/a.ts · requested lines 10–14",
    });
    expect(summarizeCall(call("read", { path: "a.ts", offset: 10 })).detail).toBe(
      "a.ts · requested from line 10",
    );
    expect(summarizeCall(call("edit", { path: "C:\\src\\a.ts" }))).toEqual({
      title: "Edit a.ts",
      detail: "C:\\src\\a.ts",
    });
    expect(summarizeCall(call("write", { file_path: "src/b.ts", content: "x\ny\n" }))).toEqual({
      title: "Write b.ts",
      detail: "src/b.ts",
    });
  });

  test("names a search's pattern and scope without inventing its purpose", () => {
    expect(summarizeCall(call("grep", { pattern: "TODO", path: "src" }))).toEqual({
      title: 'Search for "TODO"',
      detail: "In src",
    });
    expect(summarizeCall(call("find", { pattern: "*.ts", glob: "src/**" }))).toEqual({
      title: 'Find files matching "*.ts"',
      detail: "In src/**",
    });
    expect(summarizeCall(call("ls", {}))).toEqual({
      title: "List directory",
      detail: "Current directory",
    });
  });

  test("labels exact known commands, but does not guess what a script or compound command does", () => {
    expect(summarizeCall(call("bash", { command: "pnpm test" }))).toEqual({
      title: "Run tests",
      detail: "pnpm test",
    });
    expect(summarizeCall(call("bash", { command: "pnpm test && pnpm build" })).title).toBe(
      "Run bash command",
    );
    expect(summarizeCall(call("powershell", { command: "Get-ChildItem src" }))).toEqual({
      title: "Run powershell command",
      detail: "Get-ChildItem src",
    });
  });

  test("makes extension names readable and labels their arguments", () => {
    expect(summarizeCall(call("word_count", { path: "README.md" }))).toEqual({
      title: "Word count",
      detail: "path: README.md",
    });
    expect(
      summarizeCall(call("mcp__github__pull_request_read", { method: "get", pullNumber: 123 })),
    ).toEqual({ title: "github · Pull request read", detail: "method: get · pullNumber: 123" });
    expect(summarizeCall(call("weather", { city: "Oslo" }))).toEqual({
      title: "Weather",
      detail: "city: Oslo",
    });
  });

  test("bounds summaries without serializing nested extension payloads or mutating the arguments", () => {
    const args = {
      query: "x".repeat(MAX_SUMMARY_CHARS + 1),
      options: { deep: { payload: "y".repeat(100_000) } },
      files: ["a", "b"],
      enabled: false,
    };
    const summary = summarizeCall(call("search", args));
    expect(summary.detail!.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1);
    expect(args.query.length).toBe(MAX_SUMMARY_CHARS + 1);
    expect(summarizeCall(call("search", { ...args, query: "short" })).detail).toBe(
      "query: short · options: 1 field · files: 2 items · +1 more",
    );
    expect(summarizeCall(call("tool", {}))).toEqual({ title: "Tool", detail: null });
  });

  test("ignores built-in arguments of the wrong type", () => {
    expect(summarizeCall(call("read", { path: 7, offset: "10" }))).toEqual({
      title: "Read file",
      detail: null,
    });
  });
});

describe("callMeta", () => {
  test("does not scan extension results just to discover that they have no count", () => {
    let reads = 0;
    const output = {
      get content() {
        reads++;
        return [];
      },
    };
    expect(
      callMeta({
        call: call("custom", {}),
        status: "done",
        output,
        patch: undefined,
      }),
    ).toBeNull();
    expect(reads).toBe(0);
  });

  test("counts what a finished call read, found or listed", () => {
    const read = call("read", { path: "a.ts" });
    expect(callMeta({ call: read, patch: undefined, ...done("a\nb\nc\n") })).toEqual(
      faint("3 lines"),
    );
    // read's note on how to read on isn't part of the file.
    expect(
      callMeta({
        call: read,
        patch: undefined,
        ...done("a\n\n[120 more lines in file. Use offset=2 to continue.]"),
      }),
    ).toEqual(faint("1 line"));
    const grep = call("grep", { pattern: "x" });
    expect(
      callMeta({
        call: grep,
        patch: undefined,
        ...done("a.ts:1: x\na.ts-2- context\nb.ts:9: x\n\n[100 matches limit reached]"),
      }),
    ).toEqual(faint("2 matches"));
    expect(callMeta({ call: grep, patch: undefined, ...done("No matches found") })).toEqual(
      faint("0 matches"),
    );
    expect(
      callMeta({ call: call("find", { pattern: "*.ts" }), patch: undefined, ...done("a.ts\n") }),
    ).toEqual(faint("1 file"));
    expect(
      callMeta({
        call: call("ls", {}),
        patch: undefined,
        ...done("a.ts\nsrc/\n\n[500 entries limit reached]"),
      }),
    ).toEqual(faint("2 entries"));
  });

  test("shows an edit's patch stats and a test runner's verdict", () => {
    const patch = "--- a\n+++ a\n@@ -1 +1,2 @@\n-x\n+y\n+z\n";
    expect(
      callMeta({ call: call("edit", { path: "a" }), patch, ...done("Successfully replaced") }),
    ).toEqual({ kind: "stats", additions: 2, deletions: 1 });
    expect(
      callMeta({
        call: call("bash", { command: "pnpm test" }),
        patch: undefined,
        ...done(" Test Files  3 passed (3)\n      Tests  42 passed (42)\n"),
      }),
    ).toEqual({ kind: "text", text: "42 passed", tone: "success" });
  });

  test("falls back to what the arguments say until the call has finished", () => {
    const read = call("read", { path: "a.ts", offset: 10, limit: 5 });
    expect(callMeta({ call: read, status: "running", output: null, patch: undefined })).toEqual(
      faint("lines 10–14"),
    );
    expect(
      callMeta({
        call: call("grep", { pattern: "x" }),
        status: "running",
        output: null,
        patch: undefined,
      }),
    ).toBeNull();
    expect(
      callMeta({
        call: call("write", { path: "b.ts", content: "x\ny\n" }),
        patch: undefined,
        ...done("Successfully wrote to b.ts"),
      }),
    ).toEqual(faint("2 lines"));
    expect(
      callMeta({ call: call("bash", { command: "ls" }), patch: undefined, ...done("a\nb\n") }),
    ).toBeNull();
  });
});

describe("testVerdict", () => {
  test("reads the runners' totals, with failures first", () => {
    expect(testVerdict("Tests:       3 passed, 3 total\n")?.text).toBe("3 passed");
    expect(testVerdict("===== 42 passed in 1.2s =====")?.text).toBe("42 passed");
    expect(testVerdict("  41 passing\n  1 failing\n")).toEqual({
      kind: "text",
      text: "1 failed",
      tone: "failure",
    });
    expect(testVerdict("test result: ok. 42 passed; 0 failed")?.text).toBe("42 passed");
    expect(testVerdict("29 total\n")).toBeNull();
  });
});

describe("workLogDuration and formatDuration", () => {
  const calls = [call("bash", {}, "a"), call("read", {}, "b")];

  test("spans from the message's stamp to the last result's", () => {
    const results = new Map([
      ["a", result("a", "x", false, 1_500)],
      ["b", result("b", "y", false, 4_200)],
    ]);
    expect(workLogDuration(1_000, calls, results)).toBe(3_200);
  });

  test("is null until every call has a result, or when the stamps don't add up", () => {
    const one = new Map([["a", result("a", "x", false, 1_500)]]);
    expect(workLogDuration(1_000, calls, one)).toBeNull();
    const early = new Map([
      ["a", result("a", "x", false, 900)],
      ["b", result("b", "y", false, 4_200)],
    ]);
    expect(workLogDuration(1_000, calls, early)).toBeNull();
    expect(workLogDuration(undefined, calls, early)).toBeNull();
  });

  test("formats whole seconds, minutes and hours", () => {
    expect(formatDuration(160)).toBe("1s");
    expect(formatDuration(8_000)).toBe("8s");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
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
