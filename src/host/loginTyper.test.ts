import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginTyper } from "./loginTyper";

const READY = "\u001b[?2004h";
const NOTICE = "\u001b[33mStartup is still in progress\u001b[39m";

let write: ReturnType<typeof vi.fn<(data: string) => void>>;
let typer: LoginTyper;
beforeEach(() => {
  vi.useFakeTimers();
  write = vi.fn<(data: string) => void>();
  typer = new LoginTyper("anthropic", write);
});
afterEach(() => {
  typer.stop();
  vi.useRealTimers();
});

const writes = () => write.mock.calls.map(([data]) => data);

describe("LoginTyper", () => {
  it("types the command once pi is ready, then Enter once output goes quiet", () => {
    typer.output("\u001b[?1049h");
    expect(writes()).toEqual([]);
    typer.output(`pi${READY}`);
    expect(writes()).toEqual(["/login anthropic"]);
    vi.advanceTimersByTime(200);
    typer.output("/login anthropic");
    vi.advanceTimersByTime(249);
    expect(writes()).toEqual(["/login anthropic"]);
    vi.advanceTimersByTime(1);
    expect(writes()).toEqual(["/login anthropic", "\r"]);
    typer.output("Select an auth method");
    vi.runAllTimers();
    expect(writes()).toEqual(["/login anthropic", "\r"]);
  });

  it("finds the ready marker split across chunks", () => {
    typer.output(READY.slice(0, 4));
    typer.output(READY.slice(4));
    expect(writes()).toEqual(["/login anthropic"]);
  });

  it("presses Enter again while pi says startup is still in progress", () => {
    typer.output(READY);
    vi.advanceTimersByTime(250);
    typer.output(NOTICE.slice(0, 12));
    typer.output(NOTICE.slice(12));
    vi.advanceTimersByTime(250);
    expect(writes()).toEqual(["/login anthropic", "\r", "\r"]);
    vi.runAllTimers();
    expect(writes()).toEqual(["/login anthropic", "\r", "\r"]);
  });

  it("presses no extra Enter when the notice only comes back in a full redraw", () => {
    typer.output(READY);
    vi.advanceTimersByTime(250);
    typer.output(`\u001b[2J\u001b[H\u001b[3J${NOTICE}`);
    vi.runAllTimers();
    expect(writes()).toEqual(["/login anthropic", "\r"]);
  });

  it("presses Enter 1500 ms after typing when output never goes quiet", () => {
    typer.output(READY);
    for (let ms = 0; ms < 1_400; ms += 200) {
      vi.advanceTimersByTime(200);
      typer.output("spinner");
    }
    expect(writes()).toEqual(["/login anthropic"]);
    vi.advanceTimersByTime(100);
    expect(writes()).toEqual(["/login anthropic", "\r"]);
  });

  it("keeps going through xterm's escape-only replies to pi's queries", () => {
    for (const reply of [
      "\u001b[?62;22c",
      "\u001b[?0u",
      "\u001b]7501;1\u0007",
      "\u001bP1$r0m\u001b\\",
    ])
      typer.input(reply);
    typer.output(READY);
    typer.input("\u001b[I");
    vi.advanceTimersByTime(250);
    expect(writes()).toEqual(["/login anthropic", "\r"]);
  });

  it("stops for good once you type a character", () => {
    typer.output(READY);
    typer.input("\u001b[Ax");
    vi.runAllTimers();
    typer.output(READY);
    expect(writes()).toEqual(["/login anthropic"]);
  });

  it("gives up after 40 Enters", () => {
    typer.output(READY);
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(250);
      typer.output(NOTICE);
    }
    expect(writes().filter((data) => data === "\r")).toHaveLength(40);
  });

  it("gives up 20 s after pi was ready", () => {
    typer.output(READY);
    for (let ms = 0; ms < 25_000; ms += 100) {
      vi.advanceTimersByTime(100);
      typer.output(NOTICE);
    }
    const enters = writes().filter((data) => data === "\r").length;
    expect(enters).toBeLessThan(40);
    vi.advanceTimersByTime(1_500);
    expect(writes().filter((data) => data === "\r")).toHaveLength(enters);
    expect(enters).toBe(Math.floor(20_000 / 1_500));
  });
});
