/**
 * Kills each process group with SIGKILL. The host reports the groups it
 * starts, and main calls this when the host dies, so nothing the host started
 * outlives it.
 */
export function killProcessGroups(pgids: readonly number[]): void {
  for (const pgid of pgids) {
    // Signalling group 0 reaches main's own group, and -1 every process main
    // may signal. The host starts each group detached, so none is main's.
    if (!Number.isSafeInteger(pgid) || pgid <= 1 || pgid === process.pid) {
      console.error(`Not killing process group ${pgid}: the host can't have started it.`);
      continue;
    }
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (error) {
      // ESRCH means the group is already gone.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        console.error(`Couldn't kill process group ${pgid}:`, error);
      }
    }
  }
}
