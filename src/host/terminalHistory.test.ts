import { describe, expect, it } from "vitest";
import { HistoryFilter, TerminalHistory } from "./terminalHistory";

describe("terminal replay", () => {
  it.each([
    "\u001b[6n",
    "\u001bZ",
    "\u001b\u001b[6n",
    "\u001b[0\u009b>0c",
    "\u001b[?6n",
    "\u001b[12;5R",
    "\u001b[>0c",
    "\u001b[?2026$p",
    "\u001b[?2026;2$y",
    "\u001b[>q",
    "\u001b[?u",
    "\u001b[14t",
    "\u001b]11;?\u0007",
    "\u001bP$qm\u001b\\",
    "\u009b6n",
    "\u009d10;?\u009c",
    "\u001b]52;c;clipboard\u0007",
  ])("strips %j even across chunk boundaries", (sequence) => {
    for (let i = 0; i <= sequence.length; i++) {
      const filter = new HistoryFilter();
      expect(
        filter.push(`before${sequence.slice(0, i)}`) + filter.push(`${sequence.slice(i)}after`),
      ).toBe("beforeafter");
    }
  });

  it("keeps text, colors, cursor movement and alternate-screen controls", () => {
    const text = "你好\r\n\u001b[31mred\u001b[0m\u001b[?1049h\u001b[2J\u001b[H\u001b[?1049l";
    const filter = new HistoryFilter();
    expect([...text].map((char) => filter.push(char)).join("")).toBe(text);
  });

  it("discards oversized and unterminated control strings without leaking them", () => {
    const filter = new HistoryFilter();
    expect(filter.push("start\u001b]11;" + "x".repeat(1024 * 1024))).toBe("start");
    expect(filter.push("\u001b\\end")).toBe("end");
    expect(filter.push("\u001b[" + "1".repeat(10_000) + "mOK")).toBe("OK");
  });
});

describe("bounded terminal history", () => {
  it("caps output even without a newline", () => {
    const history = new TerminalHistory(8_192);
    for (let i = 0; i < 100; i++) history.append("x".repeat(4_096));
    expect(history.tail(Infinity)).toHaveLength(8_192);
    expect(history.tail(512)).toHaveLength(512);
  });

  it("keeps at most 5000 lines including an unfinished last line", () => {
    const history = new TerminalHistory();
    for (let i = 0; i < 10_000; i++) history.append(`line ${i}\n`);
    history.append("tail");
    const text = history.tail(Infinity);
    expect(text.split("\n").length).toBeLessThanOrEqual(5_000);
    expect(text).toContain("line 9999\ntail");
    expect(text).not.toContain("line 0\n");
  });

  it("doesn't corrupt UTF-8 when either cap cuts a character", () => {
    const history = new TerminalHistory(8_193);
    history.append("😀".repeat(20_000));
    const tail = history.tail(5_001);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(5_001);
    expect(tail).not.toContain("�");
    expect(tail).toBe("😀".repeat(1_250));
  });
});
