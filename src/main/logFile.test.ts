import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyConsoleTo, lineWriter, LogFile } from "./logFile";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tondo-log-"));
  file = path.join(dir, "logs", "main.log");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const read = (name: string) => readFileSync(path.join(dir, "logs", name), "utf8");
const files = () => readdirSync(path.join(dir, "logs")).toSorted();

describe("LogFile", () => {
  it("creates its folder and appends", () => {
    const log = new LogFile(file);
    log.write("one\n");
    log.write("two\n");
    expect(read("main.log")).toBe("one\ntwo\n");
  });

  it("moves the file aside once a write would take it past maxBytes, keeping maxFiles copies", () => {
    const log = new LogFile(file, { maxBytes: 10, maxFiles: 2 });
    for (const text of ["aaaaaa\n", "bbbbbb\n", "cccccc\n", "dddddd\n"]) log.write(text);
    expect(files()).toEqual(["main.log", "main.log.1", "main.log.2"]);
    expect([read("main.log"), read("main.log.1"), read("main.log.2")]).toEqual([
      "dddddd\n",
      "cccccc\n",
      "bbbbbb\n",
    ]);
  });

  it("keeps a write larger than maxBytes whole", () => {
    const log = new LogFile(file, { maxBytes: 4, maxFiles: 1 });
    log.write("longer than four\n");
    expect(read("main.log")).toBe("longer than four\n");
  });

  it("counts what the file already holds, and removes copies past maxFiles", () => {
    mkdirSync(path.join(dir, "logs"));
    writeFileSync(file, "12345678");
    for (const index of [1, 2, 3, 9]) writeFileSync(`${file}.${index}`, "old");
    writeFileSync(`${file}.backup`, "not a copy");
    const log = new LogFile(file, { maxBytes: 10, maxFiles: 2 });
    expect(files()).toEqual(["main.log", "main.log.1", "main.log.2", "main.log.backup"]);
    log.write("abc");
    expect(read("main.log")).toBe("abc");
    expect(read("main.log.1")).toBe("12345678");
  });

  it("reports the first failed write to stderr and never throws", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = new LogFile(file);
    // A folder where the file should be makes every append fail.
    mkdirSync(file);
    log.write("lost\n");
    log.write("lost too\n");
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(`couldn't write its log ${file}`));
  });
});

describe("lineWriter", () => {
  it("starts each line with the time and a label, across chunks that split lines", () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T10:00:00.000Z"), toFake: ["Date"] });
    const log = new LogFile(file);
    const write = lineWriter(log, "stderr");
    write("first li");
    write("ne\nsecond line\nthi");
    write("");
    write("rd\n");
    vi.useRealTimers();
    const time = "2026-09-27T10:00:00.000Z";
    expect(read("main.log")).toBe(
      `${time} stderr first line\n${time} stderr second line\n${time} stderr third\n`,
    );
  });
});

describe("copyConsoleTo", () => {
  it("writes every console call to the log, formatted, and still prints it", () => {
    const printed = vi.fn();
    const levels = ["debug", "info", "log", "warn", "error"] as const;
    const saved = levels.map((level) => [level, console[level]] as const);
    for (const level of levels) console[level] = printed;
    try {
      const log = new LogFile(file);
      copyConsoleTo(log);
      console.log("pi %s exited", "4242", { code: 1 });
      console.error(new Error("boom"));
    } finally {
      Object.assign(console, Object.fromEntries(saved));
    }
    expect(printed).toHaveBeenCalledTimes(2);
    const lines = read("main.log");
    expect(lines).toMatch(/^\S+Z log pi 4242 exited \{ code: 1 \}\n/);
    // Each line of the stack gets its own time and level, like any other line,
    // so the stack's four-space indent follows the space after the level.
    expect(lines).toMatch(/\n\S+Z error Error: boom\n\S+Z error {5}at /);
  });
});
