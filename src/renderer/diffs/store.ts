import { create } from "zustand";

/** Whether the Changes panel is open. */
export const useDiffPanel = create<boolean>(() => false);

export function toggleDiffPanel(): void {
  useDiffPanel.setState(!useDiffPanel.getState(), true);
}

/** The checkpoint turn the Changes panel shows, or null for the latest. */
export const useDiffTurn = create<number | null>(() => null);

/** Opens the Changes panel on `turn`, as a turn summary's View diff does. */
export function showTurnChanges(turn: number): void {
  useDiffTurn.setState(turn, true);
  useDiffPanel.setState(true, true);
}
