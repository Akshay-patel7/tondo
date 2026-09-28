// What the command palette lists. T3 Code's palette
// (apps/web/src/components/CommandPalette.tsx) lists actions, then recent
// threads, then projects. Tondo's matches words anywhere in an item's label
// or detail, which is enough until the list outgrows it.
import type { OpenThread, SidebarProject, SidebarThread } from "../../shared/protocol";
import { folderName } from "../format";
import { shortcutLabel } from "../shortcuts";

export type PaletteAction =
  | { readonly type: "new-thread"; readonly projectId: number }
  | { readonly type: "add-project" }
  | { readonly type: "toggle-sidebar" }
  | { readonly type: "rename-thread"; readonly threadId: string }
  | { readonly type: "pin-thread"; readonly threadId: string; readonly pinned: boolean }
  | { readonly type: "archive-thread"; readonly threadId: string; readonly archived: boolean }
  /** Opens a thread, taking it out of the archive first if it's there. */
  | { readonly type: "open-thread"; readonly threadId: string; readonly archived: boolean };

export type PaletteGroup = "Actions" | "Threads" | "Projects" | "Archived threads";

export interface PaletteItem {
  readonly key: string;
  readonly group: PaletteGroup;
  readonly label: string;
  /** The project or folder, shown after the label. Empty if there's none. */
  readonly detail: string;
  /** Empty if there's none. */
  readonly shortcut: string;
  readonly action: PaletteAction;
}

/** The most items a group lists. Searching finds the rest. */
export const GROUP_LIMIT = 50;

export interface PaletteInput {
  readonly projects: readonly SidebarProject[];
  readonly open: OpenThread | null;
  readonly sidebarHidden: boolean;
  readonly isMac: boolean;
}

export function paletteItems({
  projects,
  open,
  sidebarHidden,
  isMac,
}: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [];
  const action = (
    key: string,
    label: string,
    detail: string,
    shortcut: string,
    run: PaletteAction,
  ) => items.push({ key, group: "Actions", label, detail, shortcut, action: run });

  const here = open ? { id: open.projectId, path: open.project } : projects[0];
  if (here) {
    action("new-thread", "New thread", folderName(here.path), shortcutLabel("N", isMac), {
      type: "new-thread",
      projectId: here.id,
    });
  }
  action("add-project", "Add project…", "", shortcutLabel("O", isMac), { type: "add-project" });
  action(
    "toggle-sidebar",
    sidebarHidden ? "Show sidebar" : "Hide sidebar",
    "",
    shortcutLabel("B", isMac),
    { type: "toggle-sidebar" },
  );
  const shown = open && projects.flatMap(({ threads }) => threads).find((t) => t.id === open.id);
  if (shown) {
    const threadId = shown.id;
    if (shown.canRename) {
      action("rename-thread", "Rename thread", shown.title, "", {
        type: "rename-thread",
        threadId,
      });
    }
    action("pin-thread", shown.pinned ? "Unpin thread" : "Pin thread", shown.title, "", {
      type: "pin-thread",
      threadId,
      pinned: !shown.pinned,
    });
    action(
      "archive-thread",
      shown.archived ? "Unarchive thread" : "Archive thread",
      shown.title,
      "",
      {
        type: "archive-thread",
        threadId,
        archived: !shown.archived,
      },
    );
  }

  const newestFirst: { thread: SidebarThread; path: string }[] = projects
    .flatMap(({ path, threads }) => threads.map((thread) => ({ thread, path })))
    .toSorted((a, b) => b.thread.updatedAt - a.thread.updatedAt);
  for (const { thread, path } of newestFirst) {
    items.push({
      key: `thread:${thread.id}`,
      group: thread.archived ? "Archived threads" : "Threads",
      label: thread.title,
      detail: folderName(path),
      shortcut: "",
      action: { type: "open-thread", threadId: thread.id, archived: thread.archived },
    });
  }

  for (const project of projects) {
    items.push({
      key: `project:${project.id}`,
      group: "Projects",
      label: `New thread in ${folderName(project.path)}`,
      detail: project.path,
      shortcut: "",
      action: { type: "new-thread", projectId: project.id },
    });
  }

  const order: PaletteGroup[] = ["Actions", "Threads", "Projects", "Archived threads"];
  return order.flatMap((group) => items.filter((item) => item.group === group));
}

/**
 * The items whose label or detail holds every word of `query`, ignoring
 * case, with at most `limit` from each group.
 */
export function filterItems(
  items: readonly PaletteItem[],
  query: string,
  limit = GROUP_LIMIT,
): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const counts = new Map<PaletteGroup, number>();
  return items.filter((item) => {
    const text = `${item.label} ${item.detail}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) return false;
    const count = counts.get(item.group) ?? 0;
    counts.set(item.group, count + 1);
    return count < limit;
  });
}
