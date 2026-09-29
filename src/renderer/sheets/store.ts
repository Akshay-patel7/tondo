import { create } from "zustand";
import type { Sheet } from "../../shared/protocol";

/** A panel a slash command opened: one the host answered for, or the shortcut sheet. */
export type OpenSheet = Sheet | { readonly kind: "hotkeys" };

export const useSheet = create<OpenSheet | null>()(() => null);

export function openSheet(sheet: OpenSheet): void {
  useSheet.setState(sheet, true);
}

export function closeSheet(): void {
  useSheet.setState(null, true);
}
