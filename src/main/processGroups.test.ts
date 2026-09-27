import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopProcessGroups } from "./processGroups";

const started: number[] = [];

/**
 * Starts `script` in a shell that leads a new process group, the way the host
 * starts pi, and resolves once the script has printed its first line. The
 * shell's stdin stays open, so a script can wait on it the way pi does.
 */
async function startGroup(script: string) {
  const child = spawn("sh", ["-c", script], {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (child.pid === undefined) throw new Error("sh didn't start");
  started.push(child.pid);
  await once(child.stdout, "data");
  child.stdout.resume();
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  return { child, pgid: child.pid, closed };
}

/** A shell that forks sleep into its group, so the group has two processes. */
const SLEEPS = "sleep 60 & echo started; wait";

describe.skipIf(process.platform === "win32")("stopProcessGroups", () => {
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

  it("lets a group that's exiting by itself finish before it signals it", async () => {
    // Like pi, this shell exits once its stdin closes.
    const { child, pgid, closed } = await startGroup("echo started; read line; exit 7");
    const stopped = stopProcessGroups([pgid], 10_000);
    child.stdin.end();
    const [code, signal] = await closed;
    expect({ code, signal }).toEqual({ code: 7, signal: null });
    await stopped;
  });

  it("sends SIGTERM to a group that doesn't exit by itself", async () => {
    const { pgid, closed } = await startGroup(SLEEPS);
    await stopProcessGroups([pgid], 50);
    const [code, signal] = await closed;
    expect({ code, signal }).toEqual({ code: null, signal: "SIGTERM" });
  });

  it("sends SIGKILL to a group that ignores SIGTERM", async () => {
    const { pgid, closed } = await startGroup(`trap '' TERM; ${SLEEPS}`);
    await stopProcessGroups([pgid], 50);
    const [code, signal] = await closed;
    expect({ code, signal }).toEqual({ code: null, signal: "SIGKILL" });
  });

  it("returns at once for a group that's already gone", async () => {
    // One process, which Node reaps before the close event, so the group is
    // empty by then. A grandchild such as SLEEPS' sleep is reaped later by
    // whoever adopts it, and Linux counts it as a member until then.
    const { pgid, closed } = await startGroup("echo started; read line");
    process.kill(-pgid, "SIGKILL");
    await closed;
    const kill = vi.spyOn(process, "kill");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await stopProcessGroups([pgid], 60_000);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-pgid, 0);
    expect(logged).not.toHaveBeenCalled();
  });

  it("never signals main's group, every process, or a value that isn't a pgid", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await stopProcessGroups([0, 1, -1, process.pid, 1.5, Number.NaN]);
    expect(kill).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(6);
  });
});
