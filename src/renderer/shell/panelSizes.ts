import { PANEL_WIDTH_RANGES, type PanelWidths } from "../../shared/settings";

/** Fit the preferred widths without overwriting them when the window narrows. */
export function panelSizes(
  widths: PanelWidths,
  viewport: number,
  sidebarShown: boolean,
  changesShown: boolean,
) {
  // Usually leave 320px for the thread. When the user explicitly shows both
  // panels in a tiny window, keep the panels usable and give the thread the rest.
  const minimumThread = changesShown
    ? Math.min(
        320,
        Math.max(
          0,
          viewport -
            (sidebarShown ? PANEL_WIDTH_RANGES.sidebar.min : 0) -
            PANEL_WIDTH_RANGES.changes.min,
        ),
      )
    : Math.min(320, viewport);
  const reservedChanges = changesShown
    ? Math.min(
        widths.changes,
        Math.max(0, viewport - (sidebarShown ? PANEL_WIDTH_RANGES.sidebar.min : 0) - minimumThread),
      )
    : 0;
  const sidebarMax = Math.min(
    PANEL_WIDTH_RANGES.sidebar.max,
    Math.max(0, viewport - reservedChanges - minimumThread),
  );
  const sidebar = sidebarShown ? Math.min(widths.sidebar, sidebarMax) : 0;
  const changesMax = Math.min(
    PANEL_WIDTH_RANGES.changes.max,
    Math.max(0, viewport - sidebar - minimumThread),
  );
  const changes = changesShown ? Math.min(widths.changes, changesMax) : 0;
  return { sidebar, changes, sidebarMax, changesMax };
}
