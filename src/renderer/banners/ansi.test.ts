import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("drops the colors pi puts on its stderr", () => {
    expect(stripAnsi("\u001B[33mWarning: slow\u001B[39m\n\u001B[31mError: failed\u001B[0m")).toBe(
      "Warning: slow\nError: failed",
    );
    expect(stripAnsi("\u001B[38;2;138;190;183mcolored\u001B[39m and \u001B[2Kplain")).toBe(
      "colored and plain",
    );
  });

  it("drops OSC strings and C1 CSI sequences", () => {
    expect(stripAnsi("\u001B]0;window title\u0007text")).toBe("text");
    expect(stripAnsi("\u001B]8;;https://example.com\u001B\\link\u001B]8;;\u001B\\")).toBe("link");
    expect(stripAnsi("\u009B31mC1 red")).toBe("C1 red");
  });

  it("leaves text without escapes as it is", () => {
    expect(stripAnsi("[33m isn't an escape without ESC")).toBe("[33m isn't an escape without ESC");
    expect(stripAnsi("tabs\tand\nnewlines")).toBe("tabs\tand\nnewlines");
  });
});
