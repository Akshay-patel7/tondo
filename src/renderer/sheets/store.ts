import { create } from "zustand";
import type { Sheet } from "../../shared/protocol";

/** A panel a slash command opened: one the host answered for, or the shortcut sheet. */
export type OpenSheet = Sheet | { readonly kind: "hotkeys" };

/**
 * The last panel a slash command opened, and whether it's still open. A closed
 * panel stays here while it fades out. `id` counts the panels opened, so each
 * one starts fresh.
 */
export const useSheet = create<{
  readonly sheet: OpenSheet | null;
  readonly open: boolean;
  readonly id: number;
}>()(() => ({ sheet: null, open: false, id: 0 }));

export function openSheet(sheet: OpenSheet): void {
  useSheet.setState(({ id }) => ({ sheet, open: true, id: id + 1 }));
}

export function closeSheet(): void {
  useSheet.setState({ open: false });
}
