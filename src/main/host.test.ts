import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORT_MESSAGE, type HostConfig } from "../shared/protocol";
import { startHost, type HostOptions } from "./host";
import { stopProcessGroups } from "./processGroups";

const electron = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
  MessageChannelMain: class {
    port1 = "host's end";
    port2 = "page's end";
  },
}));
vi.mock("./processGroups", () => ({ stopProcessGroups: vi.fn() }));

/** Stands in for one of the host's output streams. */
class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
}

/** Stands in for the host's utility process. */
class FakeHost extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn();
  stdout = new FakeStream();
  stderr = new FakeStream();
  ready() {
    this.emit("message", { type: "ready" });
  }
}

const config: HostConfig = { userData: "/profile", piAgentDir: "/profile/pi-agent", piArgs: [] };
let hosts: FakeHost[];
let options: HostOptions;
const latest = () => hosts.at(-1)!;

function fakePage() {
  const page = { isDestroyed: () => false, postMessage: vi.fn() };
  return { page, webContents: page as unknown as WebContents };
}

describe("startHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(stopProcessGroups).mockResolvedValue();
    hosts = [];
    options = {
      entry: "host.js",
      config,
      chooseFolder: vi.fn().mockResolvedValue(null),
      onOutput: vi.fn(),
    };
    electron.fork.mockImplementation(() => {
      const host = new FakeHost();
      hosts.push(host);
      return host;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(stopProcessGroups).mockReset();
  });

  it("forks the host with its config as the first argument", () => {
    startHost(options);
    expect(electron.fork).toHaveBeenCalledWith(
      "host.js",
      [JSON.stringify(config)],
      expect.objectContaining({ serviceName: "Tondo Host", stdio: "pipe" }),
    );
  });

  it("passes on everything the host prints", () => {
    startHost(options);
    latest().stdout.emit("data", "listening\n");
    latest().stderr.emit("data", "a warning\n");
    expect(options.onOutput).toHaveBeenNthCalledWith(1, "stdout", "listening\n");
    expect(options.onOutput).toHaveBeenNthCalledWith(2, "stderr", "a warning\n");
  });

  it("hands the page a port once the host is ready", () => {
    const { page, webContents } = fakePage();
    startHost(options).connect(webContents);
    expect(page.postMessage).not.toHaveBeenCalled();

    latest().ready();
    expect(latest().postMessage).toHaveBeenCalledWith({ type: "connect" }, ["host's end"]);
    expect(page.postMessage).toHaveBeenCalledWith(PORT_MESSAGE, null, ["page's end"]);
  });

  it("restarts a host that dies, and waits longer each time it dies before it's ready", () => {
    startHost(options);
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
    startHost(options).connect(webContents);
    latest().ready();
    latest().emit("exit", 9);
    vi.advanceTimersByTime(500);
    latest().ready();
    expect(page.postMessage).toHaveBeenCalledTimes(2);
  });

  it("logs a fatal error in the host, then restarts it when it exits", () => {
    startHost(options);
    latest().emit("error", "FatalError", "v8::ToLocalChecked", "the report");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("FatalError at v8::ToLocalChecked"),
    );

    latest().emit("exit", 5);
    vi.advanceTimersByTime(500);
    expect(hosts).toHaveLength(2);
  });

  it("stops the process groups a host reported when it dies", () => {
    const host = startHost(options);
    latest().emit("message", { type: "process-groups", pgids: [4242] });
    expect(host.processGroups).toEqual([4242]);
    latest().emit("exit", 9);
    expect(stopProcessGroups).toHaveBeenLastCalledWith([4242]);
    expect(host.processGroups).toEqual([]);

    // The next host starts with none.
    vi.advanceTimersByTime(500);
    latest().emit("exit", 9);
    expect(stopProcessGroups).toHaveBeenLastCalledWith([]);
  });

  it("stops once the host has exited and its process groups are gone", async () => {
    let groupsGone!: () => void;
    vi.mocked(stopProcessGroups).mockReturnValue(new Promise((resolve) => (groupsGone = resolve)));
    const host = startHost(options);
    latest().emit("message", { type: "process-groups", pgids: [4242] });

    let stopped = false;
    const stopping = host.stop().then(() => (stopped = true));
    expect(latest().kill).toHaveBeenCalled();
    latest().emit("exit", 0);
    expect(stopProcessGroups).toHaveBeenLastCalledWith([4242]);
    // Lets every promise that can settle do so, and shows no restart comes.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopped).toBe(false);
    expect(hosts).toHaveLength(1);

    groupsGone();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("doesn't restart a host that died just before it was stopped", async () => {
    const host = startHost(options);
    latest().emit("exit", 9);
    await host.stop();
    vi.advanceTimersByTime(60_000);
    expect(hosts).toHaveLength(1);
  });

  it("shows the folder dialog when the host asks for a project", async () => {
    options.chooseFolder = vi.fn().mockResolvedValue("/project");
    startHost(options);
    latest().ready();
    const answered = new Promise((resolve) => latest().postMessage.mockImplementation(resolve));

    latest().emit("message", { type: "choose-project" });
    await expect(answered).resolves.toEqual({ type: "project-chosen", folder: "/project" });
  });

  it("answers with no folder when the dialog fails", async () => {
    options.chooseFolder = vi.fn().mockRejectedValue(new Error("No window"));
    startHost(options);
    latest().ready();
    const answered = new Promise((resolve) => latest().postMessage.mockImplementation(resolve));

    latest().emit("message", { type: "choose-project" });
    await expect(answered).resolves.toEqual({ type: "project-chosen", folder: null });
    expect(console.error).toHaveBeenCalledWith(
      "Tondo couldn't show the folder dialog:",
      new Error("No window"),
    );
  });

  it("fails a garbage collection the host dies in", async () => {
    const host = startHost(options);
    await expect(host.collectGarbage()).rejects.toThrow("isn't running");

    latest().ready();
    const collected = host.collectGarbage();
    expect(latest().postMessage).toHaveBeenLastCalledWith({ type: "collect-garbage" });
    latest().emit("exit", 9);
    await expect(collected).rejects.toThrow("exited with code 9");
  });
});
