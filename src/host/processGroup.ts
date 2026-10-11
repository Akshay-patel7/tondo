import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How often a group that's being stopped is checked for members. */
const POLL_MS = 25;

/**
 * Sends `signal` to every process in group `pgid`, and returns false if no
 * process in the group can take it. Signal 0 only checks. That's ESRCH for an
 * empty group, and EPERM when every process left belongs to another user or,
 * on macOS, has exited but not been reaped yet.
 */
export function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "EPERM") return false;
    throw error;
  }
}

/**
 * The process groups, other than group `pid`, that hold processes descended
 * from process `pid`. pi starts each bash command in a group of its own, and
 * once pi has gone, nothing links those groups to it any more.
 */
export async function descendantGroups(pid: number): Promise<number[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,pgid="]);
  const children = new Map<number, { pid: number; pgid: number }[]>();
  for (const line of stdout.split("\n")) {
    const [child, parent, pgid] = line.trim().split(/\s+/).map(Number);
    if (child === undefined || parent === undefined || pgid === undefined) continue;
    if (!Number.isSafeInteger(child) || !Number.isSafeInteger(pgid)) continue;
    children.set(parent, [...(children.get(parent) ?? []), { pid: child, pgid }]);
  }
  const groups = new Set<number>();
  const parents = [pid];
  for (let parent = parents.pop(); parent !== undefined; parent = parents.pop()) {
    for (const child of children.get(parent) ?? []) {
      if (child.pgid !== pid && child.pgid > 1) groups.add(child.pgid);
      parents.push(child.pid);
    }
  }
  return [...groups];
}

/**
 * Stops what's left of a process group: SIGTERM now, SIGKILL for anything
 * still there after `graceMs`. Resolves once the group is empty.
 * src/main/processGroups.ts does the same for groups a dead host leaves.
 */
export async function drainGroup(pgid: number, graceMs: number): Promise<void> {
  if (!signalGroup(pgid, "SIGTERM") || (await emptiesWithin(pgid, graceMs))) return;
  // Killed processes stay in the group until their parent reaps them. On
  // macOS, a process that forks while SIGKILL goes out can leave a child
  // that never gets it, so every check sends SIGKILL again.
  if (!(await emptiesWithin(pgid, graceMs, "SIGKILL"))) {
    throw new Error(`Process group ${pgid} still has processes after SIGKILL`);
  }
}

/**
 * Resolves true once group `pgid` has no processes, or false after `ms`.
 * Each check sends `signal` to the group.
 */
async function emptiesWithin(
  pgid: number,
  ms: number,
  signal: NodeJS.Signals | 0 = 0,
): Promise<boolean> {
  const deadline = performance.now() + ms;
  while (signalGroup(pgid, signal)) {
    if (performance.now() >= deadline) return false;
    // oxlint-disable-next-line eslint/no-await-in-loop -- each check waits for the one before it.
    await delay(POLL_MS);
  }
  return true;
}
