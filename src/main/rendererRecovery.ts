// Reloads the page when its renderer process dies. The page loads again and
// gets a new port, and the host sends it the thread. The cap of three reloads
// a minute is T3 Code's, from apps/desktop/src/window/DesktopWindow.ts, so a
// page that crashes as it loads doesn't reload forever.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { WebContents } from "electron";

const MAX_RELOADS = 3;
const RELOAD_WINDOW_MS = 60_000;

export function reloadWhenRendererDies(contents: WebContents): void {
  let reloadedAt: number[] = [];
  contents.on("render-process-gone", (_event, { reason, exitCode }) => {
    if (reason === "clean-exit" || contents.isDestroyed()) return;
    const now = Date.now();
    reloadedAt = reloadedAt.filter((time) => now - time < RELOAD_WINDOW_MS);
    if (reloadedAt.length >= MAX_RELOADS) {
      console.error(
        `Tondo's renderer died (${reason}, exit code ${exitCode}). It already reloaded ${MAX_RELOADS} times in the last minute, so it stays down.`,
      );
      return;
    }
    reloadedAt.push(now);
    console.error(`Tondo's renderer died (${reason}, exit code ${exitCode}). Reloading the page.`);
    contents.reload();
  });
}
