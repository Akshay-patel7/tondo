import { describe, expect, it } from "vitest";
import { TERMINAL_CONTEXT_CHARS } from "../shared/terminal";
import { TerminalContext, terminalContextSuffix } from "./terminalContext";

describe("terminal context", () => {
  it("starts off, captures no history retroactively, and needs no output to send a message", () => {
    const context = new TerminalContext();
    context.append("old output\r\n");
    expect(context.take()).toBeNull();
    context.setEnabled(true);
    expect(context.pending).toBe(false);
    expect(context.take()).toBeNull();
    context.append("new output\r\n");
    expect(context.take()?.text).toBe("new output\n");
    expect(context.take()).toBeNull();
  });

  it.each([1, 4])("captures exactly %i commands, once, in output order", (count) => {
    const context = new TerminalContext(true);
    for (let i = 1; i <= count; i++) context.append(`$ command ${i}\r\nresult ${i}\r\n`);
    const expected = Array.from(
      { length: count },
      (_, i) => `$ command ${i + 1}\nresult ${i + 1}\n`,
    ).join("");
    expect(context.preview().text).toBe(expected);
    expect(context.take()?.text).toBe(expected);
    expect(context.pending).toBe(false);
    expect(context.take()).toBeNull();
    context.append("later output");
    expect(context.take()?.text).toBe("later output");
  });

  it("strips split colors, queries, OSC payloads and controls, preserving Unicode and tabs", () => {
    const context = new TerminalContext(true);
    context.append("\u001b[3");
    context.append("1mred\u001b[0m\u001b[6n\u001b]52;c;SECRET");
    context.append("\u0007\r");
    context.append("\n界😀\tvalue\u0000\u0007\u007f\n");
    expect(context.preview()).toEqual({ text: "red\n界😀\tvalue\n", truncated: false });
  });

  it("doesn't expose a control string when sharing is enabled midway through it", () => {
    const context = new TerminalContext();
    context.append("\u001b]52;c;hidden");
    context.setEnabled(true);
    context.append("still hidden\u0007visible");
    expect(context.preview().text).toBe("visible");
  });

  it("handles backspaces within and between output chunks", () => {
    const context = new TerminalContext(true);
    context.append("ab😀");
    context.append("\b\bcd\be");
    expect(context.preview().text).toBe("ace");
  });

  it("bounds the tail, reports truncation and never begins on half an emoji", () => {
    const context = new TerminalContext(true);
    context.append("earlier\n" + "😀".repeat(TERMINAL_CONTEXT_CHARS));
    context.append("\nLATEST");
    const preview = context.preview();
    expect(preview.text.length).toBeLessThanOrEqual(TERMINAL_CONTEXT_CHARS);
    expect(preview.truncated).toBe(true);
    expect(preview.text).not.toContain("earlier");
    expect(preview.text).toMatch(/^😀/);
    expect(preview.text).toMatch(/LATEST$/);
    expect(terminalContextSuffix(preview)).toContain("earlier output was omitted");
  });

  it("discards output without disabling sharing, and disabling starts a fresh capture", () => {
    const context = new TerminalContext(true);
    context.append("discarded");
    context.discard();
    expect(context.enabled).toBe(true);
    expect(context.take()).toBeNull();
    context.append("also discarded");
    context.setEnabled(false);
    context.append("private");
    context.setEnabled(true);
    context.append("public");
    expect(context.take()?.text).toBe("public");
  });

  it.each(["forward", "reverse"])(
    "restores concurrent rejected sends in output order with %s completion",
    (order) => {
      const context = new TerminalContext(true);
      context.append("first\n");
      const first = context.take()!;
      context.append("second\n");
      const second = context.take()!;
      context.append("third\n");
      const sends = order === "forward" ? [first, second] : [second, first];
      for (const send of sends) context.restore(send);
      expect(context.take()?.text).toBe("first\nsecond\nthird\n");
      expect(context.take()).toBeNull();
    },
  );

  it.each(["discard", "disable"])("does not restore a rejected send after %s", (action) => {
    const context = new TerminalContext(true);
    context.append("private");
    const send = context.take()!;
    if (action === "discard") context.discard();
    else {
      context.setEnabled(false);
      context.setEnabled(true);
    }
    context.append("new");
    context.restore(send);
    expect(context.preview().text).toBe("new");
  });

  it("preserves indentation and trailing spaces while ignoring whitespace-only output", () => {
    const context = new TerminalContext(true);
    context.append("\n  ");
    expect(context.take()).toBeNull();
    context.append("indented code  \n");
    expect(context.take()?.text).toBe("\n  indented code  \n");
  });

  it("keeps restoration bounded when new output already filled the buffer", () => {
    const context = new TerminalContext(true);
    context.append("older");
    const send = context.take()!;
    context.append("n".repeat(TERMINAL_CONTEXT_CHARS));
    context.restore(send);
    expect(context.preview()).toEqual({
      text: "n".repeat(TERMINAL_CONTEXT_CHARS),
      truncated: true,
    });
  });

  it("ignores only exact redraws, preserving split mismatches and repeated real lines", () => {
    const context = new TerminalContext(true);
    context.append("prompt> ", false);
    context.resize();
    context.append("\r\u001b[Kpro");
    context.resize();
    context.append("mpt> \r\u001b[Jprompt> ");
    expect(context.take()).toBeNull();
    context.append("\rpro");
    context.append("gress output\r\n");
    expect(context.take()?.text).toBe("\nprogress output\n");
    context.resize();
    context.append("repeated\r\nrepeated\r\n");
    expect(context.take()?.text).toBe("repeated\nrepeated\n");
  });

  it("doesn't retain unbounded input lines or let an old redraw swallow a new shell", () => {
    const context = new TerminalContext(true);
    context.append("x".repeat(TERMINAL_CONTEXT_CHARS + 1), false);
    context.resize();
    context.append("\rnew output");
    expect(context.take()?.text).toBe("\nnew output");
    context.resize();
    context.newShell();
    context.append("\rnew output");
    expect(context.take()?.text).toBe("\nnew output");
  });

  it("resets the parser for a new shell without losing unsent output", () => {
    const context = new TerminalContext(true);
    context.append("old\n\u001b]unfinished");
    context.newShell();
    context.append("new");
    expect(context.preview().text).toBe("old\nnew");
  });
});
