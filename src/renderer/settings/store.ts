// Whether the settings page replaces the thread, and which section it shows.
import { create } from "zustand";
import { requestPiConfigFiles, useHost } from "../connection";

export type SettingsSection =
  | "appearance"
  | "pi"
  | "accounts"
  | "threads"
  | "scripts"
  | "shortcuts";

export const useSettingsPage = create<{ open: boolean; section: SettingsSection }>()(() => ({
  open: false,
  section: "appearance",
}));

/**
 * What had focus when the page opened, and whether it showed it. The page
 * replaces the thread in the commit that mounts it, so by the time the page
 * looks, an opener in the thread, such as the composer, is gone.
 */
let opener: { element: Element | null; focusVisible: boolean } | null = null;

export function openSettings(section?: SettingsSection): void {
  if (!useSettingsPage.getState().open) {
    const element = document.activeElement;
    opener = { element, focusVisible: element?.matches(":focus-visible") ?? false };
  }
  useSettingsPage.setState(section === undefined ? { open: true } : { open: true, section });
  requestPiConfigFiles();
}

/** The opener openSettings saw, once. */
export function takeSettingsOpener(): { element: Element | null; focusVisible: boolean } {
  const taken = opener ?? { element: document.activeElement, focusVisible: false };
  opener = null;
  return taken;
}

export function closeSettings(): void {
  useSettingsPage.setState({ open: false });
  // The onboarding screens show settingsError too, and a change refused here
  // isn't theirs to report.
  useHost.setState({ settingsError: null });
}
