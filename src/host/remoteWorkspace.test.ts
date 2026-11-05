import { EventEmitter, once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  NO_EXTENSION_UI,
  PROTOCOL_VERSION as v,
  type ClientMessage,
  type HostMessage,
  type OpenThread,
} from "../shared/protocol";
import { threadFromMessages, type PiMessage } from "../shared/thread";
import type { HostToRemote } from "../shared/remote";
import type { LiveThread } from "./liveThread";
import { RemoteWorkspace } from "./remoteWorkspace";
import { SessionHistory } from "./history";

function harness(ack = true) {
  const outgoing: HostToRemote[] = [];
  const events = new EventEmitter();
  const unobserve = vi.fn();
  const state = threadFromMessages(
    Array.from(
      { length: 100 },
      (_, i) => ({ role: "user", content: `message ${i}`, timestamp: i }) as PiMessage,
    ),
  );
  const threads = new Map<string, LiveThread>();
  const options = {
    thread: vi.fn((id: string) => {
      if (!threads.has(id))
        threads.set(id, {
          id,
          state,
          ui: NO_EXTENSION_UI,
          remoteSnapshot: () => state,
          observeRemote: () => unobserve,
          stop: vi.fn(),
          answer: vi.fn(),
          sessionFile: null,
        } as unknown as LiveThread);
      return threads.get(id)!;
    }),
    newThread: vi.fn(() => "new"),
    describe: (thread: LiveThread) => ({ id: thread.id, title: thread.id }) as OpenThread,
    sidebar: () => [],
    prompt: vi.fn(async () => {}),
    checkPool: vi.fn(),
  };
  const remote = new RemoteWorkspace(options, (message) => {
    outgoing.push(message);
    if (ack && message.type === "message")
      remote.handle({ type: "delivered", clientId: message.clientId });
    if (message.type === "message" && message.message.type === "remote-result")
      events.emit(message.message.id, message.message);
  });
  function connect(id: string) {
    remote.handle({ type: "connect", clientId: id });
  }
  async function request(clientId: string, message: ClientMessage) {
    const id = `action-${outgoing.length}`;
    const result = once(events, id);
    remote.handle({ type: "request", clientId, id, message });
    return (await result)[0] as Extract<HostMessage, { type: "remote-result" }>;
  }
  return { remote, options, connect, request, outgoing, threads, unobserve };
}

it("keeps selections independent, shares the thread object, and sends only that peer's events", async () => {
  const h = harness();
  h.connect("phone");
  h.connect("tablet");
  await h.request("phone", { v, type: "open-thread", threadId: "one" });
  await h.request("tablet", { v, type: "open-thread", threadId: "two" });
  h.outgoing.length = 0;
  h.remote.events("one", [{ type: "agent_start" }]);
  expect(h.outgoing).toEqual([
    {
      type: "message",
      clientId: "phone",
      message: { v, type: "events", threadId: "one", events: [{ type: "agent_start" }] },
    },
  ]);
  await h.request("tablet", { v, type: "open-thread", threadId: "one" });
  expect(h.threads.size).toBe(2);
  expect(h.unobserve).toHaveBeenCalledTimes(1);
  h.remote.close();
  expect(h.unobserve).toHaveBeenCalledTimes(3);
});

it("does not start pi when listing threads and bounds initial history to the latest 64 messages", async () => {
  const h = harness();
  h.connect("phone");
  expect(h.options.thread).not.toHaveBeenCalled();
  await h.request("phone", { v, type: "open-thread", threadId: "one" });
  const frame = h.outgoing.findLast(
    (entry) => entry.type === "message" && entry.message.type === "snapshot",
  );
  expect(
    frame?.type === "message" && frame.message.type === "snapshot" && frame.message.state.messages,
  ).toHaveLength(64);
  expect(frame).toMatchObject({ message: { historyOmitted: true } });
});

it("rejects commands for a thread not selected on this device and returns failed prompt receipts", async () => {
  const h = harness();
  h.connect("phone");
  await h.request("phone", { v, type: "open-thread", threadId: "one" });
  const message = {
    v,
    type: "prompt",
    threadId: "two",
    text: "hello",
    streamingBehavior: "steer",
  } as const;
  expect((await h.request("phone", message)).error).toContain("Open that thread");
  expect(h.options.prompt).not.toHaveBeenCalled();
  h.options.prompt.mockRejectedValueOnce(new Error("pi stopped"));
  expect((await h.request("phone", { ...message, threadId: "one" })).error).toBe("pi stopped");
});

it("counts remote viewing and leaving as recent use for the shared pi pool", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const h = harness();
  h.connect("phone");
  try {
    await h.request("phone", { v, type: "open-thread", threadId: "one" });
    expect(h.threads.get("one")!.lastUsed).toBe(1000);
    clock.mockReturnValue(2000);
    h.remote.handle({ type: "disconnect", clientId: "phone" });
    expect(h.threads.get("one")!.lastUsed).toBe(2000);
  } finally {
    clock.mockRestore();
    h.remote.close();
  }
});

it("bounds the host-to-gateway queue without waiting for or stalling a slow phone", async () => {
  const h = harness(false);
  h.connect("phone");
  for (let i = 0; i < 100; i++) h.remote.sidebar([]);
  expect(h.outgoing.some((message) => message.type === "close")).toBe(true);
  expect(h.options.checkPool).toHaveBeenCalled();
});

it("allows healthy lifecycle bursts while retaining credit-based delivery", () => {
  const h = harness(false);
  h.connect("phone");
  for (let i = 0; i < 20; i++) h.remote.sidebar([]);
  expect(h.outgoing).toHaveLength(1);
  expect(h.outgoing.some((message) => message.type === "close")).toBe(false);
  for (let i = 0; i < 24; i++) h.remote.handle({ type: "delivered", clientId: "phone" });
  expect(h.outgoing).toHaveLength(23);
  expect(h.outgoing.every((message) => message.type === "message")).toBe(true);
});

it("bounds queued bytes even when the message count is small", () => {
  const h = harness(false);
  h.connect("phone");
  const projects = [{ id: 1, path: "x".repeat(600_000), collapsed: false, threads: [] }];
  for (let i = 0; i < 3; i++) h.remote.sidebar(projects);
  expect(h.outgoing.at(-1)).toMatchObject({
    type: "close",
    reason: expect.stringContaining("too slow"),
  });
});

it("rejects oversized data before posting it across the worker port and leaves pi running", async () => {
  const h = harness();
  h.connect("phone");
  await h.request("phone", { v, type: "open-thread", threadId: "one" });
  const thread = h.threads.get("one")!;
  Object.assign(thread, { ui: { ...NO_EXTENSION_UI, title: "x".repeat(8 * 1024 * 1024) } });
  h.outgoing.length = 0;
  h.remote.uiChanged(thread);
  expect(h.outgoing).toEqual([
    { type: "close", clientId: "phone", reason: expect.stringContaining("too large") },
  ]);
  expect(thread.stop).not.toHaveBeenCalled();
  expect(h.unobserve).toHaveBeenCalledTimes(1);
});

it("removes stale thread references when the desktop deletes or stops a thread", async () => {
  const h = harness();
  h.connect("phone");
  await h.request("phone", { v, type: "open-thread", threadId: "one" });
  h.remote.closed(h.threads.get("one")!);
  expect(h.unobserve).toHaveBeenCalledTimes(1);
  expect((await h.request("phone", { v, type: "stop", threadId: "one" })).error).toContain(
    "Open that thread",
  );
});

it.each(["disconnect", "switch"])(
  "aborts saved-history scanning when the phone leaves: %s",
  async (action) => {
    const h = harness();
    h.connect("phone");
    await h.request("phone", { v, type: "open-thread", threadId: "one" });
    Object.assign(h.threads.get("one")!, { sessionFile: "/test-owned/session.jsonl" });
    const started = Promise.withResolvers<AbortSignal>();
    const aborted = Promise.withResolvers<void>();
    const read = vi.spyOn(SessionHistory, "read").mockImplementation((_file, _thread, signal) => {
      started.resolve(signal!);
      return new Promise<SessionHistory>((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            reject(new Error("History read aborted"));
          },
          { once: true },
        ),
      );
    });
    try {
      h.remote.handle({
        type: "request",
        clientId: "phone",
        id: "history",
        message: { v, type: "history-index", threadId: "one", id: "index" },
      });
      const signal = await started.promise;
      if (action === "disconnect") h.remote.handle({ type: "disconnect", clientId: "phone" });
      else await h.request("phone", { v, type: "open-thread", threadId: "two" });
      await aborted.promise;
      expect(signal.aborted).toBe(true);
    } finally {
      read.mockRestore();
      h.remote.close();
    }
  },
);

describe("network boundary defense in depth", () => {
  it("refuses desktop settings even if a compromised gateway forwards them", () => {
    const h = harness();
    h.connect("phone");
    h.remote.handle({
      type: "request",
      clientId: "phone",
      id: "bad",
      message: { v, type: "set-settings", patch: { remoteAccess: false } },
    });
    expect(h.outgoing.at(-1)?.type).toBe("close");
  });
});
