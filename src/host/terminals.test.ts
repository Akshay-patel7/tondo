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
