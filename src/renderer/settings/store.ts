// Whether the settings page replaces the thread, and which section it shows.
import { create } from "zustand";
import { requestPiConfigFiles, useHost } from "../connection";

export type SettingsSection = "appearance" | "pi" | "accounts" | "threads" | "shortcuts";

export const useSettingsPage = create<{ open: boolean; section: SettingsSection }>()(() => ({
  open: false,
  section: "appearance",
}));

export function openSettings(section?: SettingsSection): void {
  useSettingsPage.setState(section === undefined ? { open: true } : { open: true, section });
  requestPiConfigFiles();
}

export function closeSettings(): void {
  useSettingsPage.setState({ open: false });
  // The onboarding screens show settingsError too, and a change refused here
  // isn't theirs to report.
  useHost.setState({ settingsError: null });
}
