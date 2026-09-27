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
      { v, type: "play", fixture: "stream-1000", speed: 1 },
      { v, type: "play", fixture: "abort", speed: 0.25 },
      { v, type: "stop" },
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
    expect(rejection({ v, type: "open" })).toBe('unknown message type "open"');
    expect(rejection({ v, type: "snapshot" })).toBe('unknown message type "snapshot"');
  });

  it("rejects play with an unknown fixture", () => {
    expect(rejection({ v, type: "play", speed: 1 })).toBe("play: unknown fixture undefined");
    expect(rejection({ v, type: "play", fixture: "../secrets", speed: 1 })).toBe(
      'play: unknown fixture "../secrets"',
    );
  });

  it("rejects play at a speed that isn't a positive number", () => {
    for (const [speed, shown] of [
      [0, "0"],
      [-1, "-1"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      ["1", '"1"'],
      [undefined, "undefined"],
    ] as const) {
      expect(rejection({ v, type: "play", fixture: "tools", speed })).toBe(
        `play: speed must be a positive number, not ${shown}`,
      );
    }
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
  });

  it("describes hostile values without calling them", () => {
    const hostile = { toString: 1, valueOf: 1 };
    expect(rejection(hostile)).toBe("protocol version undefined isn't 1");
    expect(rejection({ v: hostile })).toBe(`protocol version an object isn't ${v}`);
    expect(rejection({ v, type: hostile })).toBe("unknown message type an object");
    expect(rejection({ v, type: "play", fixture: hostile, speed: 1 })).toBe(
      "play: unknown fixture an object",
    );
  });

  it("shortens long strings in errors", () => {
    expect(rejection({ v, type: "x".repeat(1000) })).toBe(
      `unknown message type "${"x".repeat(40)}…"`,
    );
  });
});
