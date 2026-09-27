import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiExitError, startPi, type PiProcess, type StopTimings } from "./piProcess";
import { PiCommandError, type PiRecord } from "./piRpc";

const fakePi = path.resolve(import.meta.dirname, "../../scripts/fixtures/fake-pi.mts");
/** What fake pi replays after a prompt: fixtures/tools.jsonl without its response. */
const replayed = readFileSync(
  path.resolve(import.meta.dirname, "../../fixtures/tools.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => (JSON.parse(line) as { record: PiRecord }).record)
  .filter((record) => record.type !== "response");
/** Where fake pi misbehaves, halfway through the replay. */
const middle = Math.floor(replayed.length / 2);
/** Short, so the tests that run the whole stop sequence finish fast. */
const timings: StopTimings = { stdinGraceMs: 200, termGraceMs: 200 };

type Fault =
  | "none"
  | "crash-mid-stream"
  | "malformed-line"
  | "u2028"
  | "crlf"
  | "huge-line"
  | "stop-reading"
  | "never-answer";

const running: PiProcess[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((pi) => pi.stop()));
  vi.restoreAllMocks();
});

async function start(fault: Fault) {
  const records: PiRecord[] = [];
  const groups: [number, boolean][] = [];
  const settled = Promise.withResolvers<void>();
  const pi = await startPi(
    {
      command: process.execPath,
      args: [fakePi],
      cwd: import.meta.dirname,
      env: { ...process.env, FAKE_PI_FAULT: fault },
    },
    {
      onRecord: (record) => {
        records.push(record);
        if (record.type === "agent_settled") settled.resolve();
      },
      onGroup: (pgid, isRunning) => groups.push([pgid, isRunning]),
    },
    timings,
  );
  running.push(pi);
  return { pi, records, groups, settled: settled.promise };
}

/** Silences what PiProcess logs, and returns a function that lists it. */
function captureLog() {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => log.mock.calls.map((args) => args.join(" "));
}

describe("PiProcess with fake pi", () => {
  it("answers commands, passes every event on in order, and stops when stdin closes", async () => {
    const { pi, records, groups, settled } = await start("none");
    const state = await pi.rpc.request({ type: "get_state" });
    expect(state.data).toEqual({ isStreaming: false, messageCount: 0, sessionId: "fake" });
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    expect(records).toEqual(replayed);
    expect(await pi.stop()).toEqual({ code: 0, signal: null, stderrTail: "" });
    expect(groups).toEqual([
      [pi.pid, true],
      [pi.pid, false],
    ]);
  });

  it("rejects a command pi reports failing", async () => {
    const { pi } = await start("none");
    await expect(pi.rpc.request({ type: "bogus" })).rejects.toThrow(
      new PiCommandError("pi couldn't run bogus: Unknown command: bogus"),
    );
  });

  it("reports a crash mid-stream with pi's stderr, and keeps what came before", async () => {
    const log = captureLog();
    const { pi, records } = await start("crash-mid-stream");
    await pi.rpc.request({ type: "prompt", message: "hi" });
    const exit = await pi.exited;
    expect(exit).toEqual({
      code: 1,
      signal: null,
      stderrTail: "Error: fake pi crashed mid-stream\n    at replay\n",
    });
    expect(records).toEqual(replayed.slice(0, middle));
    expect(log()).toEqual([
      `pi ${pi.pid}: pi's output ended inside a record: {"type":"message_update","assistantMe`,
    ]);
    const error = new PiExitError(exit);
    expect(error.message).toBe(
      "pi exited with code 1.\n\npi's stderr ended with:\nError: fake pi crashed mid-stream\n    at replay",
    );
    await expect(pi.rpc.request({ type: "get_state" })).rejects.toThrow(error);
  });

  it("skips a line that isn't JSON and keeps reading", async () => {
    const log = captureLog();
    const { pi, records, settled } = await start("malformed-line");
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    expect(records).toEqual(replayed);
    expect(log()).toEqual([`pi ${pi.pid}: pi wrote a line that isn't JSON: this is not JSON`]);
  });

  it("keeps U+2028 and U+2029 inside a record", async () => {
    const { pi, records, settled } = await start("u2028");
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    expect(records).toEqual(
      replayed.toSpliced(middle, 0, { type: "fake_text", text: "before\u2028between\u2029after" }),
    );
  });

  it("reads CRLF line endings", async () => {
    const { pi, records, settled } = await start("crlf");
    expect((await pi.rpc.request({ type: "get_state" })).data).toMatchObject({ sessionId: "fake" });
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    expect(records).toEqual(replayed);
  });

  it("reads a 10 MB record", async () => {
    const { pi, records, settled } = await start("huge-line");
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    const huge = records[middle]!;
    expect(huge.type).toBe("fake_text");
    expect(huge.text).toHaveLength(10 * 1024 * 1024);
    expect(/^x*$/.test(huge.text as string)).toBe(true);
    expect(records.toSpliced(middle, 1)).toEqual(replayed);
  });

  it("fails a command pi doesn't answer in time, and keeps working", async () => {
    const { pi, records, settled } = await start("never-answer");
    await expect(pi.rpc.request({ type: "get_state" }, 100)).rejects.toThrow(
      new PiCommandError("pi didn't answer get_state within 100 ms."),
    );
    await pi.rpc.request({ type: "prompt", message: "hi" });
    await settled;
    expect(records).toEqual(replayed);
  });

  it("fails the commands still waiting when pi exits", async () => {
    const { pi } = await start("never-answer");
    const failed = expect(pi.rpc.request({ type: "get_state" }, Infinity)).rejects.toThrow(
      new PiExitError({ code: 0, signal: null, stderrTail: "" }),
    );
    await pi.stop();
    await failed;
  });

  it("says pi stopped reading, and kills it when it ignores stdin closing and SIGTERM", async () => {
    const { pi, groups } = await start("stop-reading");
    await pi.rpc.request({ type: "get_state" });
    // Far more than the pipe and the stream buffers hold.
    await expect(
      pi.rpc.request({ type: "prompt", message: "x".repeat(1024 * 1024) }, 100),
    ).rejects.toThrow(
      new PiCommandError(
        "pi didn't answer prompt within 100 ms. It has stopped reading its input.",
      ),
    );
    expect(await pi.stop()).toEqual({ code: null, signal: "SIGKILL", stderrTail: "" });
    expect(groups).toEqual([
      [pi.pid, true],
      [pi.pid, false],
    ]);
  });

  it("fails to start a command that doesn't exist", async () => {
    await expect(
      startPi(
        { command: "/nonexistent/pi", args: [], cwd: import.meta.dirname, env: {} },
        { onRecord: () => {}, onGroup: () => {} },
      ),
    ).rejects.toThrow(
      `Couldn't start pi with /nonexistent/pi in ${import.meta.dirname}: spawn /nonexistent/pi ENOENT`,
    );
  });
});
