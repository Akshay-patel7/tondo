import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostMessage } from "../shared/protocol";
import { TERMINAL_WINDOW_BYTES } from "../shared/terminal";
import { Terminals } from "./terminals";

const fake = vi.hoisted(() => ({
  data: (_data: string) => {},
  exit: (_event: { exitCode: number }) => {},
  write: vi.fn(),
  resize: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  spawn: vi.fn(),
  drain: vi.fn(),
}));
vi.mock("node-pty", () => ({ spawn: fake.spawn }));
vi.mock("./processGroup", () => ({ drainGroup: fake.drain }));

beforeEach(() => {
  vi.clearAllMocks();
  fake.spawn.mockReturnValue({
    pid: 987654,
    write: fake.write,
    resize: fake.resize,
    pause: fake.pause,
    resume: fake.resume,
    onData: (callback: typeof fake.data) => {
      fake.data = callback;
    },
    onExit: (callback: typeof fake.exit) => {
      fake.exit = callback;
    },
  });
});

const launch = { command: "/bin/sh", args: ["-i"], cwd: "/tmp", env: { PATH: "/bin" } };
function setup(loader = async () => launch) {
  const messages: HostMessage[] = [];
  const groups = vi.fn();
  const terminals = new Terminals(loader, (message) => messages.push(message), groups);
  const open = async () => {
    await terminals.handle({ type: "terminal-open", threadId: "thread", kind: "shell" });
    const state = messages.findLast((m) => m.type === "terminal-state");
    if (state?.type !== "terminal-state" || !state.terminal) throw new Error("No terminal");
    return { threadId: "thread", terminalId: state.terminal.id };
  };
  return { terminals, messages, groups, open };
}

const READY = "\u001b[?2004h";
const login = (terminals: Terminals, provider?: string) =>
  terminals.handle({
    type: "terminal-open",
    threadId: "thread",
    kind: "login",
    ...(provider === undefined ? {} : { provider }),
  });
const writes = () => fake.write.mock.calls.map(([data]: unknown[]) => data);

describe("terminal sessions", () => {
  it("creates independent shells with targeted output, replay and backpressure", async () => {
    const { terminals, messages, open } = setup();
    const first = await open();
    const firstData = fake.data;
    await terminals.handle({
      type: "terminal-new",
      threadId: "thread",
      split: { terminalId: first.terminalId, direction: "vertical" },
    });
    const event = messages.findLast((m) => m.type === "terminal-state");
    if (event?.type !== "terminal-state" || !event.terminal) throw new Error("No second shell");
    const second = { threadId: "thread", terminalId: event.terminal.id };
    const secondData = fake.data;
    expect(second.terminalId).not.toBe(first.terminalId);
    expect(event.terminal.number).toBe(2);
    expect(messages).toContainEqual(
      expect.objectContaining({ split: { terminalId: first.terminalId, direction: "vertical" } }),
    );
    firstData("first only");
    secondData("second only");
    terminals.handle({
      type: "terminal-attach",
      ...first,
      attachment: "first",
      cols: 80,
      rows: 24,
    });
    terminals.handle({
      type: "terminal-attach",
      ...second,
      attachment: "second",
      cols: 80,
      rows: 24,
    });
    expect(
      messages
        .filter((m) => m.type === "terminal-output" && m.attachment === "first")
        .map((m) => m.type === "terminal-output" && m.data)
        .join(""),
    ).toBe("first only");
    expect(
      messages
        .filter((m) => m.type === "terminal-output" && m.attachment === "second")
        .map((m) => m.type === "terminal-output" && m.data)
        .join(""),
    ).toBe("second only");
    firstData("x".repeat(TERMINAL_WINDOW_BYTES * 2));
    expect(fake.pause).toHaveBeenCalled();
    secondData("still responsive");
    expect(messages.at(-1)).toMatchObject({ attachment: "second", data: "still responsive" });
    await terminals.handle({ type: "terminal-close", ...first });
    const before = messages.length;
    firstData("late");
    expect(messages.length).toBe(before);
    terminals.greet();
    expect(messages.findLast((m) => m.type === "terminal-state")).toMatchObject({
      terminal: { id: second.terminalId },
    });
    await terminals.closeAll();
  });

  it("bounds shells including pending starts and rejects foreign split targets", async () => {
    const { terminals, messages, open } = setup();
    const first = await open();
    expect(() =>
      terminals.handle({
        type: "terminal-new",
        threadId: "wrong",
        split: { terminalId: first.terminalId, direction: "vertical" },
      }),
    ).toThrow("no longer available");
    await Promise.all(
      Array.from({ length: 7 }, () =>
        terminals.handle({ type: "terminal-new", threadId: "thread" }),
      ),
    );
    expect(messages.filter((m) => m.type === "terminal-state" && m.terminal?.error)).toEqual([]);
    expect(fake.spawn).toHaveBeenCalledTimes(8);
    expect(() => terminals.handle({ type: "terminal-new", threadId: "thread" })).toThrow(
      "8 shells",
    );
    await terminals.closeAll();
  });

  it("stops capture in every shell after Send, Discard and sharing changes", async () => {
    const { terminals, messages, open } = setup();
    const first = await open();
    const firstData = fake.data;
    await terminals.handle({ type: "terminal-new", threadId: "thread" });
    const state = messages.findLast((m) => m.type === "terminal-state");
    if (state?.type !== "terminal-state" || !state.terminal) throw new Error("No shell");
    const second = { threadId: "thread", terminalId: state.terminal.id };
    const secondData = fake.data;
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    terminals.handle({ type: "terminal-write", ...first, data: "first\r" });
    terminals.handle({ type: "terminal-write", ...second, data: "second\r" });
    firstData("one\n");
    secondData("two\n");
    expect(terminals.takeContext("thread")?.text).toBe("one\ntwo\n");
    firstData("not again");
    secondData("not again");
    expect(terminals.takeContext("thread")).toBeNull();
    terminals.handle({ type: "terminal-write", ...second, data: "again\r" });
    terminals.handle({ type: "terminal-discard", threadId: "thread" });
    secondData("discarded");
    expect(terminals.takeContext("thread")).toBeNull();
    terminals.handle({ type: "terminal-write", ...first, data: "again\r" });
    terminals.handle({ type: "terminal-write", ...second, data: "again\r" });
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: false });
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    firstData("disabled first");
    secondData("disabled second");
    expect(terminals.takeContext("thread")).toBeNull();
    await terminals.closeAll();
  });

  it("keeps provider sign-in exclusive of interactive shells", async () => {
    const { terminals, open } = setup();
    const shell = await open();
    expect(() => login(terminals)).toThrow("Close this thread");
    await terminals.handle({ type: "terminal-close", ...shell });
    await login(terminals);
    expect(() => terminals.handle({ type: "terminal-new", threadId: "thread" })).toThrow(
      "Close provider sign-in",
    );
    await terminals.closeAll();
  });

  it("runs scripts in separate PTYs, preserves the shell and targets input and close by terminal id", async () => {
    const { terminals, messages, open } = setup();
    const shell = await open();
    const shellData = fake.data;
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    await terminals.openScript("thread", "Build", async () => ({
      ...launch,
      args: ["-i", "-c", "printf build"],
      cwd: os.tmpdir(),
    }));
    const first = messages.findLast((m) => m.type === "terminal-state");
    if (first?.type !== "terminal-state" || !first.terminal) throw new Error("No script");
    const script = { threadId: "thread", terminalId: first.terminal.id };
    const scriptData = fake.data;
    expect(first.terminal.script).toEqual({ name: "Build", cwd: os.tmpdir() });
    expect(terminals.scriptDirectories()).toEqual([os.tmpdir()]);
    expect(script.terminalId).not.toBe(shell.terminalId);
    expect(fake.spawn).toHaveBeenLastCalledWith(
      "/bin/sh",
      ["-i", "-c", "printf build"],
      expect.objectContaining({ cwd: os.tmpdir() }),
    );
    scriptData("private build output\n");
    expect(terminals.takeContext("thread")).toBeNull();
    terminals.handle({ type: "terminal-write", ...shell, data: "printf hello\r" });
    shellData("hello\n");
    expect(terminals.takeContext("thread")?.text).toBe("hello\n");
    terminals.handle({ type: "terminal-write", ...script, threadId: "wrong", data: "bad" });
    expect(writes()).not.toContain("bad");
    await terminals.handle({ type: "terminal-close", ...script });
    expect(terminals.scriptDirectories()).toEqual([]);
    expect(terminals.has("thread")).toBe(true);
    await terminals.handle({ type: "terminal-open", threadId: "thread", kind: "shell" });
    expect(fake.spawn).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({ terminal: { id: shell.terminalId } });
    const count = messages.length;
    terminals.greet();
    expect(
      messages
        .slice(count)
        .some((m) => m.type === "terminal-state" && m.terminal?.id === script.terminalId),
    ).toBe(false);
    await terminals.closeAll();
    expect(terminals.has("thread")).toBe(false);
  });

  it("keeps repeated script runs separate, bounds retained terminals and closes every run for a thread", async () => {
    const { terminals, messages } = setup();
    await Promise.all(
      Array.from({ length: 8 }, () => terminals.openScript("thread", "Build", async () => launch)),
    );
    expect(
      new Set(
        messages.flatMap((m) => (m.type === "terminal-state" && m.terminal ? [m.terminal.id] : [])),
      ).size,
    ).toBe(8);
    expect(() => terminals.openScript("thread", "Build", async () => launch)).toThrow(
      "Close a script terminal",
    );
    await terminals.close("thread");
    expect(terminals.has("thread")).toBe(false);
    expect(messages.filter((m) => m.type === "terminal-state" && !m.terminal)).toHaveLength(8);
  });

  it("reports script launch errors and refuses a pending script spawn after close", async () => {
    const { terminals, messages } = setup();
    await terminals.openScript("thread", "Build", async () => {
      throw new Error("Trust required");
    });
    expect(messages.at(-1)).toMatchObject({
      terminal: { status: "exited", error: "Trust required", script: { name: "Build" } },
    });
    await terminals.close("thread");
    let release!: (value: typeof launch) => void;
    const opening = terminals.openScript(
      "thread",
      "Build",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const closing = terminals.close("thread");
    release(launch);
    await Promise.all([opening, closing]);
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(terminals.has("thread")).toBe(false);
  });
  it("captures opted-in shell output without streaming it through React, and keeps it after close", async () => {
    const { terminals, messages, open } = setup();
    const session = await open();
    fake.data("not shared\n");
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    terminals.handle({ type: "terminal-write", ...session, data: "printf first\r" });
    fake.data("first\n");
    fake.data("second\n");
    expect(messages.filter((message) => message.type === "terminal-context")).toEqual([
      expect.objectContaining({ enabled: true, pending: false }),
      expect.objectContaining({ enabled: true, pending: true }),
    ]);
    terminals.handle({ type: "terminal-preview", threadId: "thread" });
    expect(messages.at(-1)).toMatchObject({ type: "terminal-preview", text: "first\nsecond\n" });
    terminals.detachAll();
    fake.data("detached\n");
    await terminals.close(session.threadId);
    const send = terminals.takeContext("thread")!;
    expect(send.text).toBe("first\nsecond\ndetached\n");
    expect(terminals.takeContext("thread")).toBeNull();
    terminals.restoreContext("thread", send);
    terminals.greet();
    expect(messages.at(-1)).toMatchObject({
      type: "terminal-context",
      enabled: true,
      pending: true,
    });
    terminals.handle({ type: "terminal-discard", threadId: "thread" });
    expect(terminals.takeContext("thread")).toBeNull();
  });

  it("doesn't attach an idle prompt redrawn by resizing or reattaching the terminal", async () => {
    const { terminals, messages, open } = setup();
    const session = await open();
    fake.data("\r\u001b[Jprompt> \u001b[K\u001b[?2004h");
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    terminals.handle({ type: "terminal-resize", ...session, cols: 90, rows: 28 });
    fake.data("\r\r\u001b[Jpro");
    fake.data("mpt> ");
    expect(terminals.takeContext("thread")).toBeNull();
    expect(messages.at(-1)).toMatchObject({ type: "terminal-context", pending: false });

    terminals.handle({ type: "terminal-attach", ...session, attachment: "a", cols: 90, rows: 30 });
    fake.data("\r\u001b[Kprompt> ");
    expect(terminals.takeContext("thread")).toBeNull();
    expect(messages.findLast((m) => m.type === "terminal-output")).toMatchObject({
      data: "\r\u001b[Kprompt> ",
    });
    terminals.handle({ type: "terminal-write", ...session, data: "printf hello\r" });
    fake.data("printf hello\r\nhello\r\nprompt> ");
    expect(terminals.takeContext("thread")?.text).toBe("printf hello\nhello\nprompt> ");
    await terminals.close(session.threadId);
  });

  it("keeps pending and real command output received during a resize", async () => {
    const { terminals, open } = setup();
    const session = await open();
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    terminals.handle({ type: "terminal-write", ...session, data: "printf saved\r" });
    fake.data("saved output\r\nprompt> ");
    terminals.handle({ type: "terminal-resize", ...session, cols: 90, rows: 28 });
    fake.data("\r\u001b[Kprompt> ");
    expect(terminals.takeContext("thread")?.text).toBe("saved output\nprompt> ");

    terminals.handle({ type: "terminal-write", ...session, data: "long-running-command\r" });
    terminals.handle({ type: "terminal-resize", ...session, cols: 90, rows: 30 });
    fake.data("real background output\r\n");
    expect(terminals.takeContext("thread")?.text).toBe("real background output\n");
    await terminals.close(session.threadId);
  });

  it("captures only after submission, not startup, typing, replies, pastes or output after send/discard", async () => {
    const { terminals, open } = setup();
    const session = await open();
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    const write = (data: string) => terminals.handle({ type: "terminal-write", ...session, data });
    fake.data("startup prompt> ");
    write("printf hello");
    fake.data("printf hello");
    write("\u001b[I\u001b[1;2R");
    fake.data("\r\u001b[Kstartup prompt> printf hello");
    expect(terminals.takeContext("thread")).toBeNull();
    write("\u001b[20");
    write("0~pasted\ntext\u001b[201~");
    fake.data("pasted\r\ntext");
    expect(terminals.takeContext("thread")).toBeNull();
    write("\r");
    fake.data("hello\r\nprompt> ");
    expect(terminals.takeContext("thread")?.text).toBe("hello\nprompt> ");
    fake.data("\r\u001b[Kprompt> ");
    expect(terminals.takeContext("thread")).toBeNull();

    write("next command\r");
    fake.data("next output\r\nprompt> ");
    terminals.handle({ type: "terminal-discard", threadId: "thread" });
    fake.data("\r\u001b[Kprompt> ");
    expect(terminals.takeContext("thread")).toBeNull();
    await terminals.close(session.threadId);
  });

  it("never captures sign-in output, even when sharing is on for that thread", async () => {
    const { terminals, messages } = setup();
    terminals.handle({ type: "terminal-sharing", threadId: "thread", enabled: true });
    await login(terminals);
    fake.data("SYNTHETIC_LOGIN_SECRET\n");
    terminals.handle({ type: "terminal-preview", threadId: "thread" });
    expect(messages.at(-1)).toMatchObject({ type: "terminal-preview", text: "" });
    expect(terminals.takeContext("thread")).toBeNull();
    await terminals.close("thread");
  });

  it("isolates output by thread and reads the saved opt-in when first opened", async () => {
    const messages: HostMessage[] = [];
    const terminals = new Terminals(
      async () => launch,
      (message) => messages.push(message),
      vi.fn(),
      undefined,
      (id) => id === "shared",
    );
    await terminals.handle({ type: "terminal-open", threadId: "shared", kind: "shell" });
    const sharedOutput = fake.data;
    const shared = messages.findLast((message) => message.type === "terminal-state");
    if (shared?.type !== "terminal-state" || !shared.terminal) throw new Error("No terminal");
    terminals.handle({
      type: "terminal-write",
      threadId: "shared",
      terminalId: shared.terminal.id,
      data: "command\r",
    });
    await terminals.handle({ type: "terminal-open", threadId: "private", kind: "shell" });
    fake.data("private\n");
    sharedOutput("shared\n");
    expect(terminals.takeContext("private")).toBeNull();
    expect(terminals.takeContext("shared")?.text).toBe("shared\n");
    await terminals.closeAll();
  });

  it("launches in the chosen folder and ignores stale terminal writes", async () => {
    const { terminals, open } = setup();
    const session = await open();
    expect(fake.spawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-i"],
      expect.objectContaining({ cwd: "/tmp", env: { PATH: "/bin", TERM: "xterm-256color" } }),
    );
    terminals.handle({ type: "terminal-write", ...session, data: "hello" });
    terminals.handle({ type: "terminal-write", ...session, terminalId: "old", data: "wrong" });
    expect(fake.write.mock.calls).toEqual([["hello"]]);
    await terminals.close(session.threadId);
    expect(fake.drain).toHaveBeenCalledWith(987654, 1_000);
  });

  it("reports a deleted project folder instead of starting a shell that exits at once", async () => {
    const gone = path.join(os.tmpdir(), `tondo-gone-${process.pid}`);
    const { terminals, messages } = setup(async () => ({ ...launch, cwd: gone }));
    await terminals.handle({ type: "terminal-open", threadId: "thread", kind: "shell" });
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(messages.findLast((m) => m.type === "terminal-state")).toMatchObject({
      terminal: {
        status: "exited",
        error: `Couldn't start the terminal: the folder ${gone} no longer exists.`,
      },
    });
  });

  it("pauses until parsed output is acknowledged, and rejects stale acknowledgements", async () => {
    const { terminals, open, messages } = setup();
    const session = await open();
    terminals.handle({ type: "terminal-attach", ...session, attachment: "a", cols: 80, rows: 24 });
    fake.data("x".repeat(TERMINAL_WINDOW_BYTES * 2));
    const output = () => messages.filter((m) => m.type === "terminal-output");
    expect(output().reduce((n, m) => n + m.data.length, 0)).toBe(TERMINAL_WINDOW_BYTES);
    expect(fake.pause).toHaveBeenCalledOnce();
    terminals.handle({ type: "terminal-ack", ...session, attachment: "old", sequence: 1 });
    expect(output()).toHaveLength(16);
    for (let sequence = 1; sequence <= 32; sequence++)
      terminals.handle({ type: "terminal-ack", ...session, attachment: "a", sequence });
    expect(output().reduce((n, m) => n + m.data.length, 0)).toBe(TERMINAL_WINDOW_BYTES * 2);
    expect(fake.resume).toHaveBeenCalledOnce();
    await terminals.close(session.threadId);
  });

  it("replays bounded sanitized history and detaches without killing a background shell", async () => {
    const { terminals, open, messages } = setup();
    const session = await open();
    fake.data("hello\u001b[6n\r\n");
    terminals.handle({ type: "terminal-attach", ...session, attachment: "a", cols: 80, rows: 24 });
    const output = messages.filter((m) => m.type === "terminal-output");
    expect(output.map((m) => m.data).join("")).toBe("hello\r\n");
    terminals.detachAll();
    fake.data("background");
    expect(messages.filter((m) => m.type === "terminal-output")).toHaveLength(1);
    expect(fake.drain).not.toHaveBeenCalled();
    await terminals.close(session.threadId);
  });

  it("replays more than 512 KiB without dropping output or bypassing backpressure", async () => {
    const { terminals, open, messages } = setup();
    const session = await open();
    const text = "large command output\r\n".repeat(40_000);
    fake.data(text);
    terminals.handle({ type: "terminal-attach", ...session, attachment: "a", cols: 80, rows: 24 });
    expect(
      messages.reduce(
        (bytes, message) =>
          bytes + (message.type === "terminal-output" ? Buffer.byteLength(message.data) : 0),
        0,
      ),
    ).toBeLessThanOrEqual(TERMINAL_WINDOW_BYTES);
    const replay: string[] = [];
    // Acknowledging a chunk appends the next pending output to messages.
    for (const message of messages) {
      if (message.type !== "terminal-output") continue;
      replay.push(message.data);
      terminals.handle({
        type: "terminal-ack",
        ...session,
        attachment: "a",
        sequence: message.sequence,
      });
    }
    expect(replay.join("").length).toBe(text.length);
    expect(replay.join("") === text).toBe(true);
    expect(fake.pause).toHaveBeenCalledOnce();
    expect(fake.resume).toHaveBeenCalledOnce();
    await terminals.close(session.threadId);
  });

  it("keeps ownership and permits retry after cleanup fails", async () => {
    const { terminals, open, messages, groups } = setup();
    const session = await open();
    fake.drain.mockRejectedValueOnce(new Error("group still alive"));
    await expect(terminals.close(session.threadId)).rejects.toThrow("group still alive");
    expect(messages.at(-1)).toMatchObject({
      terminal: { status: "running", error: "Couldn't stop the terminal: group still alive" },
    });
    expect(groups).toHaveBeenLastCalledWith([987654]);
    await terminals.close(session.threadId);
    expect(messages.at(-1)).toMatchObject({ terminal: null });
    expect(groups).toHaveBeenLastCalledWith([]);
  });

  it("keeps a naturally exited terminal until explicitly closed", async () => {
    const { terminals, messages, open } = setup();
    const session = await open();
    fake.exit({ exitCode: 0 });
    expect(messages.at(-1)).toMatchObject({ terminal: { status: "exited", exitCode: 0 } });
    expect(terminals.has(session.threadId)).toBe(true);
    await terminals.close(session.threadId);
    expect(messages.at(-1)).toMatchObject({ terminal: null });
  });

  it("replaces an exited terminal when it is opened again", async () => {
    const { terminals, messages, open } = setup();
    const first = await open();
    fake.exit({ exitCode: 3 });
    const second = await open();
    expect(second.terminalId).not.toBe(first.terminalId);
    expect(fake.spawn).toHaveBeenCalledTimes(2);
    expect(messages).toContainEqual(expect.objectContaining({ terminal: null }));
    expect(messages.at(-1)).toMatchObject({
      terminal: { id: second.terminalId, status: "running", exitCode: null },
    });
    await terminals.close(second.threadId);
  });

  it.each(["closed", "replaced"])("ignores late exits from %s sessions", async (state) => {
    const { terminals, messages, open } = setup();
    const session = await open();
    const exit = fake.exit;
    await terminals.close(session.threadId);
    if (state === "replaced") await open();
    const count = messages.length;

    // The process group can disappear before node-pty delivers its exit callback.
    exit({ exitCode: 0 });
    expect(messages).toHaveLength(count);
    expect(terminals.has(session.threadId)).toBe(state === "replaced");
    await terminals.close(session.threadId);
  });

  it("tells the workspace when a terminal's process exits, unless Tondo is stopping", async () => {
    const ended = vi.fn();
    const terminals = new Terminals(
      async () => launch,
      () => {},
      vi.fn(),
      ended,
    );
    await terminals.handle({ type: "terminal-open", threadId: "thread", kind: "login" });
    fake.exit({ exitCode: 0 });
    expect(ended).toHaveBeenCalledExactlyOnceWith("thread", "login");

    await terminals.handle({ type: "terminal-open", threadId: "other", kind: "login" });
    const stopping = terminals.closeAll();
    fake.exit({ exitCode: 0 });
    await stopping;
    expect(ended).toHaveBeenCalledOnce();
  });

  describe("a login terminal that names a provider", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());

    it("types /login and presses Enter once pi is ready", async () => {
      const { terminals } = setup();
      await login(terminals, "GitHub Copilot");
      fake.data(READY);
      vi.advanceTimersByTime(250);
      expect(writes()).toEqual(["/login GitHub Copilot", "\r"]);
    });

    it("types nothing without a provider", async () => {
      const { terminals } = setup();
      await login(terminals);
      fake.data(READY);
      vi.runAllTimers();
      expect(writes()).toEqual([]);
    });

    it("ignores the provider when it reuses the thread's terminal", async () => {
      const { terminals } = setup();
      await login(terminals);
      await login(terminals, "anthropic");
      fake.data(READY);
      vi.runAllTimers();
      expect(fake.spawn).toHaveBeenCalledOnce();
      expect(writes()).toEqual([]);
    });

    it("leaves pi to you once you type, but not for xterm's replies", async () => {
      const { terminals, messages } = setup();
      await login(terminals, "anthropic");
      const state = messages.findLast((m) => m.type === "terminal-state");
      if (state?.type !== "terminal-state" || !state.terminal) throw new Error("No terminal");
      const session = { threadId: "thread", terminalId: state.terminal.id };
      terminals.handle({ type: "terminal-write", ...session, data: "\u001b[?62;22c" });
      fake.data(READY);
      terminals.handle({ type: "terminal-write", ...session, data: "q" });
      vi.runAllTimers();
      expect(writes()).toEqual(["\u001b[?62;22c", "/login anthropic", "q"]);
    });

    it("stops typing when pi exits", async () => {
      const { terminals } = setup();
      await login(terminals, "anthropic");
      fake.data(READY);
      fake.exit({ exitCode: 1 });
      vi.runAllTimers();
      expect(writes()).toEqual(["/login anthropic"]);
    });
  });

  it("cancels a pending launch when closed before environment capture finishes", async () => {
    const gate = Promise.withResolvers<typeof launch>();
    const { terminals, messages } = setup(() => gate.promise);
    const opening = terminals.handle({ type: "terminal-open", threadId: "thread", kind: "shell" });
    const closing = terminals.close("thread");
    gate.resolve(launch);
    await Promise.all([opening, closing]);
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({ type: "terminal-state", terminal: null });
  });
});
