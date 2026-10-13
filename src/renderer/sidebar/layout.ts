// Whether the sidebar is on screen. You choose, and the host keeps your choice
// as sidebarHidden. But in a window too narrow for the sidebar and a usable
// thread, such as the 840 px minimum with Changes open or the default window
// at 200% zoom, it steps aside until you show it there or the window has room.
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { DEFAULT_SETTINGS, PANEL_WIDTH_RANGES, type PanelWidths } from "../../shared/settings";
import { toggleSidebar, updateSettings, useHost, usePiUpdates } from "../connection";
import { panelSizes } from "../shell/panelSizes";
import { addToast } from "../toasts/store";
import { useRenaming } from "./store";

// Beside the 256 px sidebar, a thread of 512 px, or beside it and the Changes
// panel's 432, one of about 320. Resized panels are capped to fit the same window.
const ROOM = window.matchMedia("(min-width: 768px)");
const ROOM_BESIDE_CHANGES = window.matchMedia("(min-width: 1000px)");

const useChangesShown = create<boolean>(() => false);

/** Whether you showed the sidebar in a window without room for it. */
const useShownAnyway = create<boolean>(() => false);

// Showing it anyway lasts until the room changes: the window crosses one of
// the widths above, or Changes opens or closes.
function forgetShownAnyway(): void {
  useShownAnyway.setState(false, true);
}
ROOM.addEventListener("change", forgetShownAnyway);
ROOM_BESIDE_CHANGES.addEventListener("change", forgetShownAnyway);
useChangesShown.subscribe(forgetShownAnyway);

function subscribeToRoom(onChange: () => void): () => void {
  ROOM.addEventListener("change", onChange);
  ROOM_BESIDE_CHANGES.addEventListener("change", onChange);
  return () => {
    ROOM.removeEventListener("change", onChange);
    ROOM_BESIDE_CHANGES.removeEventListener("change", onChange);
  };
}

function hasRoom(changesShown: boolean): boolean {
  return (changesShown ? ROOM_BESIDE_CHANGES : ROOM).matches;
}

/** Whether the sidebar is on screen. */
export function useSidebarShown(): boolean {
  const hidden = useHost((host) => host.sidebarHidden);
  const changesShown = useChangesShown((shown) => shown);
  const room = useSyncExternalStore(subscribeToRoom, () => hasRoom(changesShown));
  const shownAnyway = useShownAnyway((shown) => shown);
  // A rename, such as one the palette starts, edits the title in the sidebar.
  const renaming = useRenaming((id) => id !== null);
  return !hidden && (room || shownAnyway || renaming);
}

/**
 * Shows or hides the sidebar, as its buttons and shortcut do. With room for
 * it, that changes your choice. Without, it shows the sidebar anyway or hides
 * it again, and your choice stays for when there's room.
 */
export function toggleSidebarShown(): void {
  if (hasRoom(useChangesShown.getState())) {
    toggleSidebar();
    return;
  }
  const hidden = useHost.getState().sidebarHidden;
  if (hidden) toggleSidebar();
  useShownAnyway.setState(hidden || !useShownAnyway.getState(), true);
}

// A preview is local to the page. Only releasing the drag writes settings.
const useWidthPreview = create<Partial<PanelWidths>>(() => ({}));
const savingWidths = new Map<keyof PanelWidths, number>();

useHost.subscribe((host, previous) => {
  if (host.connection !== "connected") {
    savingWidths.clear();
    useWidthPreview.setState({}, true);
    return;
  }
  if (savingWidths.size === 0 || host.settings === previous.settings) return;
  const error = host.settingsError ?? host.settingsFileError;
  if (error) {
    savingWidths.clear();
    useWidthPreview.setState({}, true);
    addToast({ level: "error", message: `Couldn't save panel width. ${error}` });
    return;
  }
  for (const [panel, value] of savingWidths) {
    if (host.settings?.panelWidths[panel] !== value) continue;
    savingWidths.delete(panel);
    // A newer drag can already be previewing another width. Its reply must not reset it.
    if (useWidthPreview.getState()[panel] === value) clearWidthPreview(panel);
  }
});

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function clearWidthPreview(panel: keyof PanelWidths): void {
  const next = { ...useWidthPreview.getState() };
  const pending = savingWidths.get(panel);
  if (pending === undefined) delete next[panel];
  else next[panel] = pending;
  useWidthPreview.setState(next, true);
}

/** The displayed width and resize controls for one of the two side panels. */
export function usePanelSize(panel: keyof PanelWidths) {
  const saved = useHost((host) => host.settings?.panelWidths ?? DEFAULT_SETTINGS.panelWidths);
  const connected = useHost((host) => host.connection === "connected");
  const updating = usePiUpdates((updates) => updates.updating);
  const preview = useWidthPreview();
  const viewport = useSyncExternalStore(subscribeToWidth, () => window.innerWidth);
  const sidebarShown = useSidebarShown();
  const changesShown = useChangesShown();
  const sizes = panelSizes({ ...saved, ...preview }, viewport, sidebarShown, changesShown);
  const max = panel === "sidebar" ? sizes.sidebarMax : sizes.changesMax;
  const range = PANEL_WIDTH_RANGES[panel];
  useEffect(() => () => clearWidthPreview(panel), [panel]);
  return {
    width: sizes[panel],
    min: Math.min(range.min, max),
    max,
    defaultWidth: DEFAULT_SETTINGS.panelWidths[panel],
    disabled: !connected || updating,
    onChange: (width: number) => useWidthPreview.setState({ [panel]: width }),
    onCancel: () => clearWidthPreview(panel),
    onCommit: (width: number) => {
      const value = Math.max(range.min, Math.min(Math.round(width), range.max));
      useWidthPreview.setState({ [panel]: value });
      savingWidths.set(panel, value);
      updateSettings({ panelWidths: { [panel]: value } });
    },
  };
}

/** Tells the sidebar, for as long as the caller is on screen, whether the Changes panel is too. */
export function useChangesPanelShown(shown: boolean): void {
  useLayoutEffect(() => {
    useChangesShown.setState(shown, true);
    return () => useChangesShown.setState(false, true);
  }, [shown]);
}
