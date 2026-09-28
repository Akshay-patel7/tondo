import { setTimeout as delay } from "node:timers/promises";

/** How long a group gets to empty at each step of stopping it. */
export const GROUP_GRACE_MS = 3_000;
/** How often a group that's being stopped is checked for members. */
const POLL_MS = 25;

/**
 * Stops the process groups a dead host reported, so nothing it started
 * outlives it. The host's death closed pi's stdin, which is how pi's rpc.md
 * asks for an orderly shutdown, so each group first gets `graceMs` to empty
 * by itself, then SIGTERM, then SIGKILL. pi stops its running bash commands,
 * which have groups of their own, when its stdin closes or on SIGTERM, but
 * not on SIGKILL.
 * Resolves once every group is empty, or has had SIGKILL's grace too.
 */
export async function stopProcessGroups(
  pgids: readonly number[],
  graceMs = GROUP_GRACE_MS,
): Promise<void> {
  await Promise.all(pgids.filter(isHostGroup).map((pgid) => stopGroup(pgid, graceMs)));
}

function isHostGroup(pgid: number): boolean {
  // Signalling group 0 reaches main's own group, and -1 every process main
  // may signal. The host starts each group detached, so none is main's.
  if (Number.isSafeInteger(pgid) && pgid > 1 && pgid !== process.pid) return true;
  console.error(`Not stopping process group ${pgid}: the host can't have started it.`);
  return false;
}

async function stopGroup(pgid: number, graceMs: number): Promise<void> {
  if (await emptiesWithin(pgid, graceMs)) return;
  if (!signalGroup(pgid, "SIGTERM") || (await emptiesWithin(pgid, graceMs))) return;
  // On macOS, a process that forks while SIGKILL goes out can leave a child
  // that never gets it, so every check sends SIGKILL again.
  if (!(await emptiesWithin(pgid, graceMs, "SIGKILL"))) {
    console.error(`Process group ${pgid} still has processes after SIGKILL.`);
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

/**
 * Sends `signal` to every process in group `pgid`, and returns false if no
 * process in the group can take it. The same as signalGroup in
 * src/host/processGroup.ts, which main can't import.
 */
function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    // ESRCH is an empty group. EPERM means every process left belongs to
    // another user or, on macOS, has exited but not been reaped yet.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "EPERM") return false;
    throw error;
  }
}
