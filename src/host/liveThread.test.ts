import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveThread, type ThreadListener } from "./liveThread";
import { PiExitError, type PiExit, type PiProcess } from "./piProcess";
import type { PiCommand, PiRecord } from "./piRpc";
import type { Supervisor } from "./supervisor";
import type { TurnCheckpoints } from "./turnCheckpoints";

const PROJECT = { id: 1, path: "/projects/demo" };
const SESSION = { id: "thread-1", file: null };

const ANSWERS: Record<string, unknown> = {
  get_state: { model: { provider: "faux", id: "m" }, thinkingLevel: "off" },
  get_available_thinking_levels: { levels: ["off"] },
  get_session_stats: {},
  get_available_models: { models: [{ provider: "faux", id: "m", name: "Model" }] },
  get_messages: { messages: [] },
  get_commands: { commands: [{ name: "deploy", source: "extension" }] },
  clear_queue: { steering: [], followUp: [] },
};

function fakePi() {
  let exit!: (value: PiExit) => void;
  const exited = new Promise<PiExit>((resolve) => (exit = resolve));
  const pi = {
    rpc: {
      request: vi.fn(async (command: PiCommand) => ({
        type: "response",
        command: command.type,
        success: true,
        data: ANSWERS[command.type],
      })),
      send: vi.fn(),
    },
    stop: vi.fn(async () => ({ code: 0, signal: null, stderrTail: "" })),
    exited,
  };
  return { pi, exit, process: pi as unknown as PiProcess };
}

function fakeListener() {
  return {
    events: vi.fn(),
    reset: vi.fn(),
    changed: vi.fn(),
    restore: vi.fn(),
    error: vi.fn(),
    uiChanged: vi.fn(),
    asked: vi.fn(),
    notified: vi.fn(),
    editorText: vi.fn(),
  } satisfies ThreadListener;
}

let pi: ReturnType<typeof fakePi>;
let emit: (record: PiRecord) => void;
let supervisor: {
  needsTrustAnswer: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  saveTrustAnswer: ReturnType<typeof vi.fn>;
  trustInfo: ReturnType<typeof vi.fn>;
};
let checkpoints: {
  busy: boolean;
  prepare: ReturnType<typeof vi.fn>;
  started: ReturnType<typeof vi.fn>;
  settled: ReturnType<typeof vi.fn>;
  drain: ReturnType<typeof vi.fn>;
};
let listener: ReturnType<typeof fakeListener>;
let thread: LiveThread;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  pi = fakePi();
  supervisor = {
    needsTrustAnswer: vi.fn(async () => false),
    start: vi.fn(async (_cwd: string, _session: unknown, onRecord: (record: PiRecord) => void) => {
      emit = onRecord;
      return pi.process;
    }),
    saveTrustAnswer: vi.fn(),
    trustInfo: vi.fn(),
  };
  checkpoints = {
    busy: false,
    prepare: vi.fn(async () => {}),
    started: vi.fn(),
    settled: vi.fn(),
    drain: vi.fn(async () => {}),
  };
  listener = fakeListener();
  thread = new LiveThread(
    PROJECT,
    SESSION,
    supervisor as unknown as Supervisor,
    listener,
    checkpoints as unknown as TurnCheckpoints,
  );
});

function confirm(id: string, title: string): PiRecord {
  return { type: "extension_ui_request", id, method: "confirm", title, message: "Sure?" };
}

describe("open", () => {
  it("starts pi in the project on the thread's session and reports the loaded thread once", async () => {
    await thread.open();
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(supervisor.start).toHaveBeenCalledWith(PROJECT.path, SESSION, expect.any(Function));
    expect(thread.status).toEqual({
      state: "ready",
      session: {
        model: { provider: "faux", id: "m" },
        models: [{ provider: "faux", id: "m", name: "Model" }],
        thinkingLevel: "off",
        thinkingLevels: ["off"],
        context: null,
        commands: [{ name: "deploy", description: "", source: "extension" }],
        signedIn: true,
      },
    });
    expect(listener.reset).toHaveBeenCalledTimes(1);
    expect(thread.busy).toBe(false);
  });

  it("asks about trust before starting pi, then starts it with the saved answer", async () => {
    supervisor.needsTrustAnswer.mockResolvedValue(true);
    await thread.open();
    expect(thread.askingTrust).toBe(true);
    expect(thread.status).toEqual({ state: "stopped" });
    expect(supervisor.start).not.toHaveBeenCalled();
    await thread.trust(true);
    expect(supervisor.saveTrustAnswer).toHaveBeenCalledWith(PROJECT.path, true);
    expect(thread.askingTrust).toBe(false);
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(thread.status.state).toBe("ready");
  });

  it("reports pi as exited with the error when it can't start", async () => {
    supervisor.start.mockRejectedValue(new Error("spawn pi ENOENT"));
    await thread.open();
    expect(thread.status).toEqual({ state: "exited", error: "spawn pi ENOENT" });
    expect(listener.reset).not.toHaveBeenCalled();
  });
});

describe("pi's events", () => {
  beforeEach(() => thread.open());

  it("skips a malformed known event with an error, and still applies the next good one", () => {
    const before = thread.state;
    emit({ type: "message_end", message: {} });
    expect(listener.error).toHaveBeenCalledTimes(1);
    expect(listener.error).toHaveBeenCalledWith(
      "pi sent a message_end event Tondo can't read, because it has no message role. Tondo skipped it.",
    );
    expect(thread.state).toBe(before);
    emit({ type: "queue_update", steering: ["steer"], followUp: ["later"] });
    expect(thread.state.queue).toEqual({ steering: ["steer"], followUp: ["later"] });
    expect(listener.error).toHaveBeenCalledTimes(1);
  });

  it("sends events to the page only while the thread is on screen", () => {
    emit({ type: "agent_start" });
    expect(listener.events).not.toHaveBeenCalled();
    expect(checkpoints.started).toHaveBeenCalledTimes(1);
    thread.show();
    const queued = { type: "queue_update", steering: ["a"], followUp: [] };
    emit(queued);
    expect(listener.events).toHaveBeenCalledTimes(1);
    expect(listener.events).toHaveBeenCalledWith([queued]);
  });

  it("stamps a retry deadline shared by live events and restored snapshots", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      thread.show();
      emit({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: "503 Service Unavailable",
      });
      expect(thread.state.retry?.retryAt).toBe(3000);
      expect(listener.events).toHaveBeenLastCalledWith([
        expect.objectContaining({ type: "auto_retry_start", retryAt: 3000 }),
      ]);
      // Switching back or reloading the page must not restart the countdown.
      clock.mockReturnValue(2500);
      thread.hide();
      thread.show();
      expect(thread.state.retry?.retryAt).toBe(3000);
    } finally {
      clock.mockRestore();
    }
  });

  it("drops records from a pi that was replaced", async () => {
    const oldEmit = emit;
    pi = fakePi();
    await thread.reload();
    oldEmit({ type: "queue_update", steering: ["stale"], followUp: [] });
    expect(thread.state.queue.steering).toEqual([]);
  });

  it("puts pi's queue back in the composer when pi exits by itself", async () => {
    emit({ type: "agent_start" });
    emit({ type: "queue_update", steering: ["first"], followUp: ["second"] });
    const exit = { code: 1, signal: null, stderrTail: "" };
    pi.exit(exit);
    await pi.process.exited;
    expect(thread.status).toEqual({ state: "exited", error: new PiExitError(exit).message });
    expect(checkpoints.settled).toHaveBeenCalledTimes(1);
    expect(listener.restore).toHaveBeenCalledWith("first\n\nsecond");
    expect(thread.state.queue).toEqual({ steering: [], followUp: [] });
  });
});

describe("extension dialogs", () => {
  beforeEach(() => thread.open());

  it("refuses a second dialog with an open dialog's id and keeps the first", () => {
    emit(confirm("d1", "First"));
    emit(confirm("d1", "Second"));
    expect(thread.ui.dialogs).toHaveLength(1);
    expect(thread.ui.dialogs[0]).toMatchObject({ id: "d1", title: "First" });
    expect(listener.asked).toHaveBeenCalledTimes(1);
    expect(pi.pi.rpc.send).toHaveBeenCalledTimes(1);
    expect(pi.pi.rpc.send).toHaveBeenCalledWith({
      type: "extension_ui_response",
      id: "d1",
      cancelled: true,
    });
  });

  it("answers an open dialog once and ignores an answer to a closed one", () => {
    emit(confirm("d1", "First"));
    expect(thread.waiting).toBe(true);
    thread.answer("d1", { confirmed: true });
    expect(pi.pi.rpc.send).toHaveBeenCalledTimes(1);
    expect(pi.pi.rpc.send).toHaveBeenCalledWith({
      type: "extension_ui_response",
      id: "d1",
      confirmed: true,
    });
    expect(thread.waiting).toBe(false);
    thread.answer("d1", { confirmed: false });
    expect(pi.pi.rpc.send).toHaveBeenCalledTimes(1);
  });

  it("cancels a dialog it can't show so the extension doesn't wait for ever", () => {
    emit({ type: "extension_ui_request", id: "bad", method: "select", title: "Pick", options: [] });
    expect(thread.ui.dialogs).toEqual([]);
    expect(pi.pi.rpc.send).toHaveBeenCalledWith({
      type: "extension_ui_response",
      id: "bad",
      cancelled: true,
    });
  });
});

describe("questionnaire lifecycle", () => {
  const questions = [
    {
      header: "First",
      question: "Pick first?",
      options: [
        { label: "A", description: "a" },
        { label: "B", description: "b" },
      ],
    },
    {
      header: "Second",
      question: "Pick second?",
      options: [
        { label: "C", description: "c" },
        { label: "D", description: "d" },
      ],
    },
  ];
  const start = (id = "tool") =>
    emit({
      type: "tool_execution_start",
      toolName: "ask_user_question",
      toolCallId: id,
      args: { questions },
    });
  const select = (id = "d1", second = false): PiRecord => {
    const question = questions[second ? 1 : 0]!;
    return {
      type: "extension_ui_request",
      id,
      method: "select",
      title: `[${question.header}] ${question.question}`,
      options: [
        ...question.options.map(
          (option, index) => `${index + 1}. ${option.label} — ${option.description}`,
        ),
        "3. Type something.",
      ],
    };
  };
  beforeEach(() => thread.open());

  it("holds the first RPC request, then replays only the submitted answers", () => {
    start();
    emit(select());
    expect(thread.ui.dialogs[0]?.method).toBe("questionnaire");
    expect(pi.pi.rpc.send).not.toHaveBeenCalled();
    expect(() => thread.answer("d1", { answers: [{ selected: [], text: "" }] })).toThrow(
      "Answer every question",
    );
    expect(thread.waiting).toBe(true);
    thread.answer("d1", {
      answers: [
        { selected: [1], text: "" },
        { selected: [0], text: "" },
      ],
    });
    expect(pi.pi.rpc.send).toHaveBeenLastCalledWith({
      type: "extension_ui_response",
      id: "d1",
      value: "2. B — b",
    });
    emit(select("d2", true));
    expect(thread.ui.dialogs).toEqual([]);
    expect(pi.pi.rpc.send).toHaveBeenLastCalledWith({
      type: "extension_ui_response",
      id: "d2",
      value: "1. C — c",
    });
  });

  it("keeps non-questionnaire selects unchanged", () => {
    emit(select());
    expect(thread.ui.dialogs[0]?.method).toBe("select");
    thread.answer("d1", { value: "2. B — b" });
    expect(pi.pi.rpc.send).toHaveBeenLastCalledWith({
      type: "extension_ui_response",
      id: "d1",
      value: "2. B — b",
    });
  });

  it.each(["tool_execution_end", "agent_settled"])("clears pending forms on %s", (type) => {
    start();
    emit(select());
    emit({
      type,
      toolCallId: "tool",
      toolName: "ask_user_question",
      result: { content: [] },
      isError: false,
    });
    expect(thread.waiting).toBe(false);
    thread.answer("d1", { cancelled: true });
    expect(pi.pi.rpc.send).not.toHaveBeenCalled();
    emit(select("after"));
    expect(thread.ui.dialogs[0]?.method).toBe("select");
  });

  it("clears submitted adapter state when pi is reloaded", async () => {
    start();
    emit(select());
    thread.answer("d1", {
      answers: [
        { selected: [0], text: "" },
        { selected: [1], text: "" },
      ],
    });
    pi = fakePi();
    await thread.reload();
    expect(thread.ui.dialogs).toEqual([]);
    emit(select("after"));
    expect(thread.ui.dialogs[0]?.method).toBe("select");
  });

  it("removes a pending questionnaire when pi exits", async () => {
    start();
    emit(select());
    pi.exit({ code: 1, signal: null, stderrTail: "" });
    await pi.process.exited;
    expect(thread.ui.dialogs).toEqual([]);
    thread.answer("d1", { cancelled: true });
    expect(pi.pi.rpc.send).not.toHaveBeenCalled();
  });

  it("falls back to ordinary dialogs for parallel question tools rather than mixing their answers", () => {
    start();
    emit(select());
    start("parallel");
    expect(thread.ui.dialogs[0]?.method).toBe("select");
    emit(select("parallel-dialog"));
    expect(thread.ui.dialogs.map((dialog) => dialog.method)).toEqual(["select", "select"]);
    thread.answer("d1", { value: "1. A — a" });
    emit(select("d2", true));
    expect(thread.ui.dialogs.map((dialog) => dialog.method)).toEqual(["select", "select"]);
    expect(pi.pi.rpc.send).toHaveBeenCalledTimes(1);
  });
});

describe("prompt", () => {
  beforeEach(() => thread.open());

  it("prepares the turn checkpoint, then sends the text with its streaming behavior", async () => {
    await thread.prompt("hello", "steer");
    expect(checkpoints.prepare).toHaveBeenCalledTimes(1);
    expect(pi.pi.rpc.request).toHaveBeenLastCalledWith(
      { type: "prompt", message: "hello", streamingBehavior: "steer" },
      Number.POSITIVE_INFINITY,
    );
    expect(listener.restore).not.toHaveBeenCalled();
  });

  it("sends terminal context with the prompt but restores only the user's text on rejection", async () => {
    await thread.prompt("look", "followUp", [], "\n\nterminal output");
    expect(pi.pi.rpc.request).toHaveBeenLastCalledWith(
      { type: "prompt", message: "look\n\nterminal output", streamingBehavior: "followUp" },
      Number.POSITIVE_INFINITY,
    );
    pi.pi.rpc.request.mockRejectedValueOnce(new Error("rejected"));
    await expect(thread.prompt("retry", "steer", [], "\n\nterminal output")).rejects.toThrow(
      "rejected",
    );
    expect(listener.restore).toHaveBeenCalledExactlyOnceWith("retry");
  });

  it("refuses pi's built-in commands and puts the text back in the composer", async () => {
    await expect(thread.prompt("/name x", "steer")).rejects.toThrow(
      "Tondo doesn't send pi's /name to pi.",
    );
    expect(listener.restore).toHaveBeenCalledWith("/name x");
    expect(pi.pi.rpc.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "prompt" }),
      expect.anything(),
    );
  });

  it("refuses images while pi works", async () => {
    emit({ type: "agent_start" });
    const image = { id: "image-1", name: "shot.png", data: "AAAA", mimeType: "image/png" };
    await expect(thread.prompt("look", "steer", [image])).rejects.toThrow(
      "Wait for pi to finish before sending images.",
    );
    expect(listener.restore).toHaveBeenCalledWith("look");
  });
});

describe("close", () => {
  it("stops pi and reports nothing afterwards", async () => {
    await thread.open();
    const report = emit;
    report(confirm("open", "Open"));
    listener.changed.mockClear();
    listener.uiChanged.mockClear();
    listener.asked.mockClear();
    await thread.close();
    expect(thread.ui.dialogs).toEqual([]);
    expect(listener.uiChanged).not.toHaveBeenCalled();
    expect(pi.pi.stop).toHaveBeenCalledTimes(1);
    expect(checkpoints.settled).toHaveBeenCalledTimes(1);
    report({ type: "agent_start" });
    report(confirm("late", "Late"));
    expect(listener.changed).not.toHaveBeenCalled();
    expect(listener.asked).not.toHaveBeenCalled();
  });
});
