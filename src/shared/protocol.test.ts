import { describe, expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION } from "./protocol";

const v = PROTOCOL_VERSION;

function rejection(data: unknown): string {
  const result = parseClientMessage(data);
  if (result.ok) throw new Error(`Expected ${JSON.stringify(data)} to be rejected`);
  return result.error;
}

describe("parseClientMessage", () => {
  it("accepts every message the page sends, as a copy", () => {
    const threadId = "0199c5e0-4a2b-7c3d-9e8f-1a2b3c4d5e6f";
    for (const message of [
      { v, type: "add-project" },
      { v, type: "remove-project", projectId: 1 },
      { v, type: "set-collapsed", projectId: 1, collapsed: true },
      { v, type: "new-thread", projectId: 2 },
      { v, type: "open-thread", threadId },
      { v, type: "rename-thread", threadId, name: "Parser fix" },
      { v, type: "pin-thread", threadId, pinned: true },
      { v, type: "archive-thread", threadId, archived: false },
      { v, type: "set-draft", threadId, text: "" },
      { v, type: "set-draft", threadId, text: "half a thought" },
      { v, type: "set-sidebar-hidden", hidden: true },
      { v, type: "refresh" },
      { v, type: "trust", threadId, trusted: true },
      { v, type: "trust", threadId, trusted: false },
      { v, type: "prompt", threadId, text: "Fix the parser", streamingBehavior: "steer" },
      { v, type: "prompt", threadId, text: "then run the tests", streamingBehavior: "followUp" },
      { v, type: "stop", threadId },
      { v, type: "dequeue", threadId },
      { v, type: "set-model", threadId, provider: "anthropic", modelId: "claude-opus-4-5" },
      { v, type: "set-thinking-level", threadId, level: "high" },
      { v, type: "restart", threadId },
      { v, type: "answer", threadId, dialogId: "d1", answer: { value: "apple" } },
      { v, type: "answer", threadId, dialogId: "d1", answer: { value: "" } },
      { v, type: "answer", threadId, dialogId: "d2", answer: { confirmed: false } },
      { v, type: "answer", threadId, dialogId: "d3", answer: { cancelled: true } },
      { v, type: "ping", id: 0 },
    ]) {
      const result = parseClientMessage(message);
      expect(result).toEqual({ ok: true, message });
      if (result.ok) expect(result.message).not.toBe(message);
    }
  });

  it("rejects anything that isn't an object", () => {
    expect(rejection(null)).toBe("a message must be an object, not null");
    expect(rejection(undefined)).toBe("a message must be an object, not undefined");
    expect(rejection("stop")).toBe('a message must be an object, not "stop"');
    expect(rejection(1)).toBe("a message must be an object, not 1");
    expect(rejection([v, "stop"])).toBe("a message must be an object, not an array");
  });

  it("rejects a missing or different protocol version", () => {
    expect(rejection({ type: "stop" })).toBe(`protocol version undefined isn't ${v}`);
    expect(rejection({ v: v + 1, type: "stop" })).toBe(`protocol version ${v + 1} isn't ${v}`);
    expect(rejection({ v: String(v), type: "stop" })).toBe(`protocol version "${v}" isn't ${v}`);
  });

  it("rejects unknown message types", () => {
    expect(rejection({ v })).toBe("unknown message type undefined");
    expect(rejection({ v, type: "play" })).toBe('unknown message type "play"');
    expect(rejection({ v, type: "snapshot" })).toBe('unknown message type "snapshot"');
  });

  it("rejects a trust answer that isn't true or false", () => {
    expect(rejection({ v, type: "trust", threadId: "t" })).toBe(
      "trust: trusted must be true or false, not undefined",
    );
    expect(rejection({ v, type: "trust", threadId: "t", trusted: "yes" })).toBe(
      'trust: trusted must be true or false, not "yes"',
    );
  });

  it("rejects a thread id that isn't a short string", () => {
    for (const [threadId, shown] of [
      [undefined, "undefined"],
      ["", '""'],
      [7, "7"],
      ["x".repeat(201), `"${"x".repeat(40)}…"`],
    ] as const) {
      for (const type of ["open-thread", "stop", "dequeue", "restart"]) {
        expect(rejection({ v, type, threadId })).toBe(
          `${type}: threadId must be a string of 1 to 200 characters, not ${shown}`,
        );
      }
    }
    expect(parseClientMessage({ v, type: "stop", threadId: "x".repeat(200) }).ok).toBe(true);
  });

  it("rejects a project id that isn't an integer", () => {
    for (const [projectId, shown] of [
      [undefined, "undefined"],
      ["1", '"1"'],
      [1.5, "1.5"],
    ] as const) {
      for (const type of ["remove-project", "new-thread"]) {
        expect(rejection({ v, type, projectId })).toBe(
          `${type}: projectId must be an integer, not ${shown}`,
        );
      }
    }
    expect(rejection({ v, type: "set-collapsed", projectId: 1, collapsed: "no" })).toBe(
      'set-collapsed: collapsed must be true or false, not "no"',
    );
  });

  it("rejects a blank name, a draft that isn't text and flags that aren't true or false", () => {
    expect(rejection({ v, type: "rename-thread", threadId: "t", name: "  " })).toBe(
      'rename-thread: name must be a string that isn\'t blank, not "  "',
    );
    expect(rejection({ v, type: "set-draft", threadId: "t", text: null })).toBe(
      "set-draft: text must be a string, not null",
    );
    expect(rejection({ v, type: "pin-thread", threadId: "t", pinned: 1 })).toBe(
      "pin-thread: pinned must be true or false, not 1",
    );
    expect(rejection({ v, type: "archive-thread", threadId: "t" })).toBe(
      "archive-thread: archived must be true or false, not undefined",
    );
    expect(rejection({ v, type: "set-sidebar-hidden", hidden: "yes" })).toBe(
      'set-sidebar-hidden: hidden must be true or false, not "yes"',
    );
  });

  it("rejects a prompt without text", () => {
    for (const [text, shown] of [
      ["", '""'],
      [" \n\t", '" \\n\\t"'],
      [undefined, "undefined"],
      [["hi"], "an array"],
    ] as const) {
      expect(
        rejection({ v, type: "prompt", threadId: "t", text, streamingBehavior: "steer" }),
      ).toBe(`prompt: text must be a string that isn't blank, not ${shown}`);
    }
  });

  it("rejects a prompt that doesn't say how to queue", () => {
    expect(rejection({ v, type: "prompt", threadId: "t", text: "hi" })).toBe(
      'prompt: streamingBehavior must be "steer" or "followUp", not undefined',
    );
    expect(
      rejection({ v, type: "prompt", threadId: "t", text: "hi", streamingBehavior: "all" }),
    ).toBe('prompt: streamingBehavior must be "steer" or "followUp", not "all"');
  });

  it("rejects a model or thinking level that isn't a string", () => {
    expect(rejection({ v, type: "set-model", threadId: "t", provider: "faux" })).toBe(
      'set-model: provider and modelId must be strings, not "faux" and undefined',
    );
    expect(rejection({ v, type: "set-thinking-level", threadId: "t", level: 3 })).toBe(
      "set-thinking-level: level must be a string, not 3",
    );
  });

  it("rejects a dialog answer that isn't exactly one field of the right type", () => {
    const answer = (value: unknown) =>
      rejection({ v, type: "answer", threadId: "t", dialogId: "d", answer: value });
    for (const [value, shown] of [
      [undefined, "undefined"],
      ["apple", '"apple"'],
      [["apple"], "an array"],
      [{}, "an object"],
      [{ value: 1 }, "an object"],
      [{ confirmed: "yes" }, "an object"],
      [{ cancelled: false }, "an object"],
      [{ value: "apple", cancelled: true }, "an object"],
      [{ choice: "apple" }, "an object"],
    ] as const) {
      expect(answer(value)).toBe(
        `answer: answer must hold one value, confirmed or cancelled field, not ${shown}`,
      );
    }
    expect(
      rejection({ v, type: "answer", threadId: "t", dialogId: "", answer: { cancelled: true } }),
    ).toBe('answer: dialogId must be a string of 1 to 200 characters, not ""');
  });

  it("rejects ping ids that aren't safe integers", () => {
    for (const [id, shown] of [
      [1.5, "1.5"],
      ["1", '"1"'],
      [2 ** 53, String(2 ** 53)],
      [undefined, "undefined"],
    ] as const) {
      expect(rejection({ v, type: "ping", id })).toBe(`ping: id must be an integer, not ${shown}`);
    }
  });

  it("rejects fields a message doesn't have", () => {
    expect(rejection({ v, type: "stop", threadId: "t", fixture: "tools" })).toBe(
      'stop: unexpected field "fixture"',
    );
    expect(rejection({ v, type: "ping", id: 1, sentAt: 0 })).toBe(
      'ping: unexpected field "sentAt"',
    );
    expect(rejection({ v, type: "add-project", folder: "/etc" })).toBe(
      'add-project: unexpected field "folder"',
    );
  });

  it("describes hostile values without calling them", () => {
    const hostile = { toString: 1, valueOf: 1 };
    expect(rejection(hostile)).toBe(`protocol version undefined isn't ${v}`);
    expect(rejection({ v: hostile })).toBe(`protocol version an object isn't ${v}`);
    expect(rejection({ v, type: hostile })).toBe("unknown message type an object");
    expect(
      rejection({ v, type: "prompt", threadId: "t", text: hostile, streamingBehavior: "steer" }),
    ).toBe("prompt: text must be a string that isn't blank, not an object");
    expect(rejection({ v, type: "open-thread", threadId: hostile })).toBe(
      "open-thread: threadId must be a string of 1 to 200 characters, not an object",
    );
  });

  it("shortens long strings in errors", () => {
    expect(rejection({ v, type: "x".repeat(1000) })).toBe(
      `unknown message type "${"x".repeat(40)}…"`,
    );
  });
});
