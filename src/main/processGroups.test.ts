import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { killProcessGroups } from "./processGroups";

const started: number[] = [];

/**
 * Starts a shell and a sleep it forks as one process group, the way the host
 * will start pi. Both hold the shell's stdout, so the child emits `close`
 * only once both are gone.
 */
async function startGroup() {
  const child = spawn("sh", ["-c", "sleep 60 & echo forked; wait"], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (child.pid === undefined) throw new Error("sh didn't start");
  started.push(child.pid);
  // The shell prints only after it has forked sleep, so the group has both.
  await once(child.stdout, "data");
  child.stdout.resume();
  return { closed: once(child, "close"), pgid: child.pid };
}

describe.skipIf(process.platform === "win32")("killProcessGroups", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const pgid of started.splice(0)) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        // Already gone, as it should be.
      }
    }
  });

  it("kills every process in the group", async () => {
    const { closed, pgid } = await startGroup();
    killProcessGroups([pgid]);
    const [code, signal] = await closed;
    expect({ code, signal }).toEqual({ code: null, signal: "SIGKILL" });
  });

  it("skips a group that's already gone", async () => {
    const { closed, pgid } = await startGroup();
    killProcessGroups([pgid]);
    await closed;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    killProcessGroups([pgid]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("never signals main's group, every process, or a value that isn't a pgid", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    killProcessGroups([0, 1, -1, process.pid, 1.5, Number.NaN]);
    expect(kill).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(6);
  });
});
