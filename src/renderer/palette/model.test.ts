import { afterEach, describe, expect, test } from "vitest";
import type { OpenThread, SidebarProject, SidebarThread } from "../../shared/protocol";
import type { TerminalState } from "../../shared/terminal";
import { useTerminals } from "../terminal/store";
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
    worktree: false,
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
  preparing: false,
  worktree: false,
  pi: { state: "stopped" },
};

const labels = (items: readonly PaletteItem[]) =>
  items.map(({ group, label }) => `${group}: ${label}`);

const terminalItem = (items: readonly PaletteItem[]) => items.find(({ key }) => key === "terminal");

describe("paletteItems", () => {
  afterEach(() => useTerminals.setState(new Map(), true));

  test("lists legacy archived sessions with recent threads and no archive action", () => {
    const items = paletteItems({ projects, open, sidebarHidden: false, isMac: true });
    expect(labels(items)).toEqual([
      "Actions: New thread",
      "Actions: Add project…",
      "Actions: Hide sidebar",
      "Actions: Settings",
      "Actions: Open terminal",
      "Actions: Rename thread",
      "Actions: Unpin thread",
      "Actions: Delete thread…",
      "Threads: Thread b",
      "Threads: Fix the build",
      "Threads: Thread a",
      "Threads: Thread z",
      "Projects: New thread in tondo",
      "Projects: New thread in pi",
    ]);
    expect(items[0]).toMatchObject({ detail: "tondo", shortcut: "⌘N" });
    expect(items[0]!.action).toEqual({ type: "new-thread", projectId: 1 });
    expect(items[3]).toMatchObject({ shortcut: "⌘,", action: { type: "settings" } });
    expect(items.find(({ key }) => key === "delete-thread")?.action).toEqual({
      type: "delete-thread",
      threadId: "a",
    });
    expect(items.find(({ key }) => key === "thread:z")!.action).toEqual({
      type: "open-thread",
      threadId: "z",
    });
  });

  test("starts a new thread in the first project when none is open", () => {
    const items = paletteItems({ projects, open: null, sidebarHidden: true, isMac: false });
    expect(labels(items).slice(0, 5)).toEqual([
      "Actions: New thread",
      "Actions: Add project…",
      "Actions: Show sidebar",
      "Actions: Settings",
      "Threads: Thread b",
    ]);
    expect(items[0]).toMatchObject({ shortcut: "Ctrl+N", action: { projectId: 1 } });
  });

  test("offers only Add project and the sidebar without projects", () => {
    const items = paletteItems({ projects: [], open: null, sidebarHidden: false, isMac: true });
    expect(labels(items)).toEqual([
      "Actions: Add project…",
      "Actions: Hide sidebar",
      "Actions: Settings",
    ]);
  });

  test("opens the open thread's terminal, or closes it", () => {
    const input = { projects, open, sidebarHidden: false, isMac: true };
    expect(terminalItem(paletteItems(input))).toMatchObject({
      label: "Open terminal",
      shortcut: "",
      action: { type: "terminal", open: true },
    });
    const running: TerminalState = {
      id: "t1",
      kind: "shell",
      status: "running",
      error: null,
      exitCode: null,
    };
    useTerminals.setState(new Map([["a", running]]), true);
    expect(terminalItem(paletteItems(input))).toMatchObject({
      label: "Close terminal",
      action: { type: "terminal", open: false },
    });
    const asking = { ...open, askingTrust: true };
    expect(terminalItem(paletteItems({ ...input, open: asking }))).toBeUndefined();
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
      "Threads: Thread z",
      "Projects: New thread in tondo",
    ]);
  });

  test.each(["ENG-4051", "eng-4051", "Eng-4051"])(
    "finds the same ticket threads for %s regardless of title case",
    (query) => {
      const items = paletteItems({
        projects: [
          {
            ...projects[0]!,
            threads: [
              thread("upper", 30, { title: "Fix ENG-4051" }),
              thread("lower", 20, { title: "Review eng-4051" }),
              thread("other", 10, { title: "Fix ENG-4052" }),
            ],
          },
        ],
        open: null,
        sidebarHidden: false,
        isMac: true,
      });
      expect(labels(filterItems(items, query))).toEqual([
        "Threads: Fix ENG-4051",
        "Threads: Review eng-4051",
      ]);
    },
  );

  test("keeps everything for a blank query, up to the limit in each group", () => {
    expect(filterItems(items, " ")).toEqual(items);
    expect(labels(filterItems(items, "", 1))).toEqual([
      "Actions: New thread",
      "Threads: Thread b",
      "Projects: New thread in tondo",
    ]);
  });
});
