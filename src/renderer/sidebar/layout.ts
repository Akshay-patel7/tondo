// Whether the sidebar is on screen. You choose, and the host keeps your choice
// as sidebarHidden. But in a window too narrow for the sidebar and a usable
// thread, such as the 840 px minimum with Changes open or the default window
// at 200% zoom, it steps aside until you show it there or the window has room.
import { useLayoutEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { toggleSidebar, useHost } from "../connection";
import { useRenaming } from "./store";

// Beside the 256 px sidebar, a thread of 512 px, or beside it and the Changes
// panel's 420, one of about 320.
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

/** Tells the sidebar, for as long as the caller is on screen, whether the Changes panel is too. */
export function useChangesPanelShown(shown: boolean): void {
  useLayoutEffect(() => {
    useChangesShown.setState(shown, true);
    return () => useChangesShown.setState(false, true);
  }, [shown]);
}
