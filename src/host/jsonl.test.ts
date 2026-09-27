import { describe, expect, it } from "vitest";
import { LineSplitter, MAX_RECORD_CHARS, RecordTooLongError } from "./jsonl";

function split(chunks: string[]): { lines: string[]; rest: string } {
  const lines: string[] = [];
  const splitter = new LineSplitter((line) => lines.push(line));
  for (const chunk of chunks) splitter.push(chunk);
  return { lines, rest: splitter.end() };
}

describe("LineSplitter", () => {
  it("splits on LF and keeps U+2028 and U+2029 inside a record", () => {
    const record = JSON.stringify({ type: "message_update", delta: "one\u2028two\u2029three" });
    const { lines } = split([`${record}\n{"type":"agent_end"}\n`]);
    expect(lines).toEqual([record, '{"type":"agent_end"}']);
    expect(JSON.parse(lines[0]!)).toEqual({
      type: "message_update",
      delta: "one\u2028two\u2029three",
    });
  });

  it("strips the CR of a CRLF ending, even when the CR and LF arrive apart", () => {
    const { lines } = split(['{"a":1}\r\n{"b":2}\r', '\n{"c":3}\r\n']);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("keeps a CR that isn't right before the LF", () => {
    const { lines } = split(['{"text":"a\\rb"}\r\n', "\r\r\n"]);
    expect(lines).toEqual(['{"text":"a\\rb"}', "\r"]);
  });

  it("joins a record that arrives in many chunks", () => {
    const record = JSON.stringify({ type: "response", data: "x".repeat(1000) });
    const chunks = record.match(/.{1,7}/gs)!;
    chunks.push("\n");
    expect(split(chunks).lines).toEqual([record]);
  });

  it("passes empty lines through and returns an unfinished line from end()", () => {
    const { lines, rest } = split(['{"a":1}\n\n{"b":', "2"]);
    expect(lines).toEqual(['{"a":1}', ""]);
    expect(rest).toBe('{"b":2');
  });

  it("joins a 10 MB record sent in 64 KB chunks", () => {
    const record = JSON.stringify({ type: "response", data: "y".repeat(10 * 1024 * 1024) });
    const text = `${record}\n`;
    const chunks: string[] = [];
    for (let at = 0; at < text.length; at += 64 * 1024) chunks.push(text.slice(at, at + 64 * 1024));
    const { lines, rest } = split(chunks);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBe(record.length);
    expect(rest).toBe("");
  });

  it("throws once a line runs past the cap, then keeps working", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    const piece = "z".repeat(MAX_RECORD_CHARS / 4);
    splitter.push(piece);
    splitter.push(piece);
    splitter.push(piece);
    splitter.push(piece);
    expect(() => splitter.push("z")).toThrow(RecordTooLongError);
    splitter.push('{"after":true}\n');
    expect(lines).toEqual(['{"after":true}']);
  });
});
