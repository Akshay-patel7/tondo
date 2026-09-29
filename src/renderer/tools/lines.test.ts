import { describe, expect, test } from "vitest";
import { displayLines, MAX_LINE_CHARS, visibleLines } from "./lines";

describe("displayLines", () => {
  test("splits on newlines, without an empty last line", () => {
    expect(displayLines("a\nb\n")).toEqual(["a", "b"]);
    expect(displayLines("")).toEqual([""]);
  });

  test("shows tabs as four spaces", () => {
    expect(displayLines("\tx")).toEqual(["    x"]);
  });

  test("cuts a very long line", () => {
    const [line] = displayLines("x".repeat(MAX_LINE_CHARS + 5));
    expect(line).toBe(`${"x".repeat(MAX_LINE_CHARS)}…`);
  });
});

// 18 px lines in a 360 px view: 20 lines at a time, and 5 lines of overscan.
const linesAt = (scrollTop: number, lineCount = 1000) =>
  visibleLines(scrollTop, 360, 18, lineCount, 5);

describe("visibleLines", () => {
  test("at the top, the first screen plus the overscan below it", () => {
    expect(linesAt(0)).toEqual({ start: 0, end: 25 });
  });

  test("scrolled down, the lines in view plus the overscan on each side", () => {
    // 900 px down is line 50.
    expect(linesAt(900)).toEqual({ start: 45, end: 75 });
  });

  test("never past the last line", () => {
    expect(linesAt(18_000 - 360)).toEqual({ start: 975, end: 1000 });
    expect(linesAt(0, 3)).toEqual({ start: 0, end: 3 });
  });

  test("a negative scroll, as padding gives, counts as the top", () => {
    expect(linesAt(-8)).toEqual({ start: 0, end: 25 });
  });
});
