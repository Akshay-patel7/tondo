import { create } from "zustand";

/** Whether the command palette is open. */
export const usePalette = create<boolean>()(() => false);

export function togglePalette(): void {
  usePalette.setState((open) => !open, true);
}

export function closePalette(): void {
  usePalette.setState(false, true);
}
