import { create } from "zustand";

/** The thread whose title the sidebar is editing, or null. */
export const useRenaming = create<string | null>()(() => null);

export function startRename(threadId: string): void {
  useRenaming.setState(threadId, true);
}

export function endRename(): void {
  useRenaming.setState(null, true);
}
