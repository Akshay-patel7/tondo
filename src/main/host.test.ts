import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORT_MESSAGE } from "../shared/protocol";
import { startHost } from "./host";
import { killProcessGroups } from "./processGroups";

const electron = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
  MessageChannelMain: class {
    port1 = "host's end";
    port2 = "page's end";
  },
}));
vi.mock("./processGroups", () => ({ killProcessGroups: vi.fn() }));

/** Stands in for the host's utility process. */
class FakeHost extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn();
  ready() {
    this.emit("message", { type: "ready" });
  }
}

let hosts: FakeHost[];
const latest = () => hosts.at(-1)!;

function fakePage() {
  const page = { isDestroyed: () => false, postMessage: vi.fn() };
  return { page, webContents: page as unknown as WebContents };
}

describe("startHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hosts = [];
    electron.fork.mockImplementation(() => {
      const host = new FakeHost();
      hosts.push(host);
      return host;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(killProcessGroups).mockClear();
  });

  it("hands the page a port once the host is ready", () => {
    const { page, webContents } = fakePage();
    startHost("host.js").connect(webContents);
    expect(page.postMessage).not.toHaveBeenCalled();

    latest().ready();
    expect(latest().postMessage).toHaveBeenCalledWith({ type: "connect" }, ["host's end"]);
    expect(page.postMessage).toHaveBeenCalledWith(PORT_MESSAGE, null, ["page's end"]);
  });

  it("restarts a host that dies, and waits longer each time it dies before it's ready", () => {
    startHost("host.js");
    for (const delay of [500, 1000, 2000, 4000, 8000, 10_000, 10_000]) {
      const forks = hosts.length;
      latest().emit("exit", 1);
      vi.advanceTimersByTime(delay - 1);
      expect(hosts).toHaveLength(forks);
      vi.advanceTimersByTime(1);
      expect(hosts).toHaveLength(forks + 1);
    }

    // A host that got as far as ready starts the backoff over.
    latest().ready();
    latest().emit("exit", 1);
    vi.advanceTimersByTime(500);
    expect(hosts).toHaveLength(9);
  });

  it("hands the page a port to the restarted host", () => {
    const { page, webContents } = fakePage();
    startHost("host.js").connect(webContents);
    latest().ready();
    latest().emit("exit", 9);
    vi.advanceTimersByTime(500);
    latest().ready();
    expect(page.postMessage).toHaveBeenCalledTimes(2);
  });

  it("logs a fatal error in the host, then restarts it when it exits", () => {
    startHost("host.js");
    latest().emit("error", "FatalError", "v8::ToLocalChecked", "the report");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("FatalError at v8::ToLocalChecked"),
    );

    latest().emit("exit", 5);
    vi.advanceTimersByTime(500);
    expect(hosts).toHaveLength(2);
  });

  it("kills the process groups a host reported when it dies", () => {
    startHost("host.js");
    latest().emit("message", { type: "process-groups", pgids: [4242] });
    latest().emit("exit", 9);
    expect(killProcessGroups).toHaveBeenLastCalledWith([4242]);

    // The next host starts with none.
    vi.advanceTimersByTime(500);
    latest().emit("exit", 9);
    expect(killProcessGroups).toHaveBeenLastCalledWith([]);
  });

  it("doesn't restart a host it stopped", () => {
    const host = startHost("host.js");
    host.stop();
    expect(latest().kill).toHaveBeenCalled();
    latest().emit("exit", 0);
    vi.advanceTimersByTime(60_000);
    expect(hosts).toHaveLength(1);
  });

  it("fails a garbage collection the host dies in", async () => {
    const host = startHost("host.js");
    await expect(host.collectGarbage()).rejects.toThrow("isn't running");

    latest().ready();
    const collected = host.collectGarbage();
    expect(latest().postMessage).toHaveBeenLastCalledWith({ type: "collect-garbage" });
    latest().emit("exit", 9);
    await expect(collected).rejects.toThrow("exited with code 9");
  });
});
