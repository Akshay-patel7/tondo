import { create } from "zustand";
import { useThreadKey } from "../thread/store";

/**
 * The work logs you collapsed in the thread on screen, by the id of each
 * log's first call. Like the expanded tool rows, it lives outside the rows
 * because the timeline unmounts a row once you scroll away from it. Logs
 * start open, so a fresh thread has an empty set.
 */
export const useCollapsedWorkLogs = create<ReadonlySet<string>>()(() => new Set());

export function toggleWorkLog(key: string): void {
  useCollapsedWorkLogs.setState((keys) => {
    const next = new Set(keys);
    if (!next.delete(key)) next.add(key);
    return next;
  }, true);
}

useThreadKey.subscribe(() => useCollapsedWorkLogs.setState(new Set(), true));
