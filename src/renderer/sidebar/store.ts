import { create } from "zustand";

/** The thread whose title the sidebar is editing, or null. */
export const useRenaming = create<string | null>()(() => null);

export function startRename(threadId: string): void {
  useRenaming.setState(threadId, true);
}

export function endRename(): void {
  useRenaming.setState(null, true);
}

/**
 * The row keyboard focus last reached: "project:<id>", "thread:<id>" or
 * "more:<id>". It's the list's one Tab stop. null until you focus a row, and
 * again once that row leaves the list.
 */
export const useFocusedRow = create<string | null>()(() => null);
