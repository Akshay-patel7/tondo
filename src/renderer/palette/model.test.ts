import { describe, expect, test } from "vitest";
import type { OpenThread, SidebarProject, SidebarThread } from "../../shared/protocol";
import { filterItems, paletteItems, type PaletteItem } from "./model";

function thread(id: string, updatedAt: number, extra: Partial<SidebarThread> = {}): SidebarThread {
  return {
    id,
    title: `Thread ${id}`,
    updatedAt,
    pinned: false,
    archived: false,
    activity: "idle",
    unread: false,
    hasDraft: false,
    canRename: true,
    ...extra,
  };
}

const projects: SidebarProject[] = [
  {
    id: 1,
    path: "/work/tondo",
    collapsed: false,
    threads: [
      thread("a", 10, { pinned: true }),
      thread("b", 30),
      thread("z", 5, { archived: true }),
    ],
  },
  {
    id: 2,
    path: "/work/pi",
    collapsed: true,
    threads: [thread("c", 20, { title: "Fix the build" })],
  },
];

const open: OpenThread = {
  id: "a",
  projectId: 1,
  project: "/work/tondo",
  title: "Thread a",
  askingTrust: false,
  pi: { state: "stopped" },
};

const labels = (items: readonly PaletteItem[]) =>
  items.map(({ group, label }) => `${group}: ${label}`);

describe("paletteItems", () => {
  test("lists actions, recent threads, projects, then archived threads", () => {
    const items = paletteItems({ projects, open, sidebarHidden: false, isMac: true });
    expect(labels(items)).toEqual([
      "Actions: New thread",
      "Actions: Add project…",
      "Actions: Hide sidebar",
      "Actions: Rename thread",
      "Actions: Unpin thread",
      "Actions: Archive thread",
      "Threads: Thread b",
      "Threads: Fix the build",
      "Threads: Thread a",
      "Projects: New thread in tondo",
      "Projects: New thread in pi",
      "Archived threads: Thread z",
    ]);
    expect(items[0]).toMatchObject({ detail: "tondo", shortcut: "⌘N" });
    expect(items[0]!.action).toEqual({ type: "new-thread", projectId: 1 });
    expect(items.at(-1)!.action).toEqual({ type: "open-thread", threadId: "z", archived: true });
  });

  test("starts a new thread in the first project when none is open", () => {
    const items = paletteItems({ projects, open: null, sidebarHidden: true, isMac: false });
    expect(labels(items).slice(0, 4)).toEqual([
      "Actions: New thread",
      "Actions: Add project…",
      "Actions: Show sidebar",
      "Threads: Thread b",
    ]);
    expect(items[0]).toMatchObject({ shortcut: "Ctrl+N", action: { projectId: 1 } });
  });

  test("offers only Add project and the sidebar without projects", () => {
    const items = paletteItems({ projects: [], open: null, sidebarHidden: false, isMac: true });
    expect(labels(items)).toEqual(["Actions: Add project…", "Actions: Hide sidebar"]);
  });

  test("offers no rename before pi has saved the thread", () => {
    const fresh = [{ ...projects[0]!, threads: [thread("a", 1, { canRename: false })] }];
    const items = paletteItems({ projects: fresh, open, sidebarHidden: false, isMac: true });
    expect(labels(items)).not.toContain("Actions: Rename thread");
  });
});

describe("filterItems", () => {
  const items = paletteItems({ projects, open, sidebarHidden: false, isMac: true });

  test("keeps items that hold every word, in the label or the detail", () => {
    expect(labels(filterItems(items, "fix PI"))).toEqual(["Threads: Fix the build"]);
    expect(labels(filterItems(items, "  thread   tondo "))).toEqual([
      "Actions: New thread",
      "Threads: Thread b",
      "Threads: Thread a",
      "Projects: New thread in tondo",
      "Archived threads: Thread z",
    ]);
  });

  test("keeps everything for a blank query, up to the limit in each group", () => {
    expect(filterItems(items, " ")).toEqual(items);
    expect(labels(filterItems(items, "", 1))).toEqual([
      "Actions: New thread",
      "Threads: Thread b",
      "Projects: New thread in tondo",
      "Archived threads: Thread z",
    ]);
  });
});
