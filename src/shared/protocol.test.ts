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
    for (const message of [
      { v, type: "open-project" },
      { v, type: "trust", trusted: true },
      { v, type: "trust", trusted: false },
      { v, type: "prompt", text: "Fix the parser", streamingBehavior: "steer" },
      { v, type: "prompt", text: "then run the tests", streamingBehavior: "followUp" },
      { v, type: "stop" },
      { v, type: "dequeue" },
      { v, type: "set-model", provider: "anthropic", modelId: "claude-opus-4-5" },
      { v, type: "set-thinking-level", level: "high" },
      { v, type: "restart" },
      { v, type: "reopen" },
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
    expect(rejection({ v, type: "trust" })).toBe(
      "trust: trusted must be true or false, not undefined",
    );
    expect(rejection({ v, type: "trust", trusted: "yes" })).toBe(
      'trust: trusted must be true or false, not "yes"',
    );
  });

  it("rejects a prompt without text", () => {
    for (const [text, shown] of [
      ["", '""'],
      [" \n\t", '" \\n\\t"'],
      [undefined, "undefined"],
      [["hi"], "an array"],
    ] as const) {
      expect(rejection({ v, type: "prompt", text, streamingBehavior: "steer" })).toBe(
        `prompt: text must be a string that isn't blank, not ${shown}`,
      );
    }
  });

  it("rejects a prompt that doesn't say how to queue", () => {
    expect(rejection({ v, type: "prompt", text: "hi" })).toBe(
      'prompt: streamingBehavior must be "steer" or "followUp", not undefined',
    );
    expect(rejection({ v, type: "prompt", text: "hi", streamingBehavior: "all" })).toBe(
      'prompt: streamingBehavior must be "steer" or "followUp", not "all"',
    );
  });

  it("rejects a model or thinking level that isn't a string", () => {
    expect(rejection({ v, type: "set-model", provider: "faux" })).toBe(
      'set-model: provider and modelId must be strings, not "faux" and undefined',
    );
    expect(rejection({ v, type: "set-thinking-level", level: 3 })).toBe(
      "set-thinking-level: level must be a string, not 3",
    );
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
    expect(rejection({ v, type: "stop", fixture: "tools" })).toBe(
      'stop: unexpected field "fixture"',
    );
    expect(rejection({ v, type: "ping", id: 1, sentAt: 0 })).toBe(
      'ping: unexpected field "sentAt"',
    );
    expect(rejection({ v, type: "open-project", folder: "/etc" })).toBe(
      'open-project: unexpected field "folder"',
    );
  });

  it("describes hostile values without calling them", () => {
    const hostile = { toString: 1, valueOf: 1 };
    expect(rejection(hostile)).toBe(`protocol version undefined isn't ${v}`);
    expect(rejection({ v: hostile })).toBe(`protocol version an object isn't ${v}`);
    expect(rejection({ v, type: hostile })).toBe("unknown message type an object");
    expect(rejection({ v, type: "prompt", text: hostile, streamingBehavior: "steer" })).toBe(
      "prompt: text must be a string that isn't blank, not an object",
    );
  });

  it("shortens long strings in errors", () => {
    expect(rejection({ v, type: "x".repeat(1000) })).toBe(
      `unknown message type "${"x".repeat(40)}…"`,
    );
  });
});
