import { beforeEach, describe, expect, it, vi } from "vitest";
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
