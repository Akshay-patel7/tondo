import { describe, expect, test } from "vitest";
import type { SidebarProject, SidebarThread } from "../../shared/protocol";
import { keepUnchanged, listedThreads, runningCount, stepThread, threadOrder } from "./model";

function thread(id: string, extra: Partial<SidebarThread> = {}): SidebarThread {
  return {
    id,
    title: `Thread ${id}`,
    updatedAt: 1,
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

function project(id: number, threads: SidebarThread[], collapsed = false): SidebarProject {
  return { id, path: `/work/p${id}`, collapsed, threads };
}

describe("keepUnchanged", () => {
  test("keeps the objects of threads and projects that didn't change", () => {
    const previous = [project(1, [thread("a"), thread("b")]), project(2, [thread("c")])];
    const next = keepUnchanged(previous, [
      project(1, [thread("a"), thread("b", { activity: "working" })]),
      project(2, [thread("c")]),
    ]);
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0]!.threads[0]).toBe(previous[0]!.threads[0]);
    expect(next[0]!.threads[1]).not.toBe(previous[0]!.threads[1]);
    expect(next[0]!.threads[1]!.activity).toBe("working");
    expect(next[1]).toBe(previous[1]);
  });

  test("replaces a row when its worktree ownership changes", () => {
    const previous = [project(1, [thread("a", { worktree: true })])];
    const next = keepUnchanged(previous, [project(1, [thread("a")])]);
    expect(next[0]!.threads[0]).not.toBe(previous[0]!.threads[0]);
    expect(next[0]!.threads[0]!.worktree).toBe(false);
  });

  test("replaces a project whose threads moved, or that collapsed", () => {
    const previous = [project(1, [thread("a"), thread("b")]), project(2, [thread("c")])];
    const next = keepUnchanged(previous, [
      project(1, [thread("b"), thread("a")]),
      project(2, [thread("c")], true),
    ]);
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0]!.threads[0]).toBe(previous[0]!.threads[1]);
    expect(next[1]).not.toBe(previous[1]);
    expect(next[1]!.collapsed).toBe(true);
  });

  test("keeps a thread that moved to another project", () => {
    const previous = [project(1, [thread("a")]), project(2, [])];
    const next = keepUnchanged(previous, [project(1, []), project(2, [thread("a")])]);
    expect(next[1]!.threads[0]).toBe(previous[0]!.threads[0]);
  });
});

describe("listedThreads", () => {
  const threads = ["a", "b", "c", "d", "e"].map((id) => thread(id));

  test("does not synthesize a row for a hidden current draft", () => {
    expect(listedThreads(threads, 2, "hidden-draft")).toEqual({
      listed: threads.slice(0, 2),
      more: 3,
    });
    expect(listedThreads([], 2, "hidden-draft")).toEqual({ listed: [], more: 0 });
    expect(stepThread(threadOrder([project(1, threads)]), "hidden-draft", 1)).toBe("a");
  });

  test("lists the first threads and counts the rest", () => {
    const { listed, more } = listedThreads(threads, 2, undefined);
    expect(listed.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(more).toBe(3);
  });

  test("adds the open thread when it's further down", () => {
    const { listed, more } = listedThreads(threads, 2, "d");
    expect(listed.map(({ id }) => id)).toEqual(["a", "b", "d"]);
    expect(more).toBe(2);
  });

  test("keeps legacy archived sessions reachable for deletion", () => {
    const withArchived = [thread("x", { archived: true }), ...threads];
    const { listed, more } = listedThreads(withArchived, 2, "x");
    expect(listed.map(({ id }) => id)).toEqual(["x", "a"]);
    expect(more).toBe(4);
  });
});

describe("runningCount", () => {
  test("counts the threads with a turn going, across projects", () => {
    const projects = [
      project(1, [
        thread("a", { activity: "working" }),
        thread("b", { activity: "waiting" }),
        thread("c", { activity: "starting" }),
        thread("d", { activity: "error" }),
        thread("e", { unread: true }),
      ]),
      project(2, [thread("f", { activity: "working" })], true),
    ];
    expect(runningCount(projects)).toBe(3);
    expect(runningCount([project(3, [thread("g")])])).toBe(0);
    expect(runningCount([])).toBe(0);
  });
});

describe("threadOrder", () => {
  test("lists expanded projects including legacy archived sessions", () => {
    const projects = [
      project(1, [thread("a"), thread("b", { archived: true })]),
      project(2, [thread("c")], true),
      project(3, [thread("d")]),
    ];
    expect(threadOrder(projects)).toEqual(["a", "b", "d"]);
  });
});

describe("stepThread", () => {
  const order = ["a", "b", "c"];

  test("moves one thread at a time and wraps around", () => {
    expect(stepThread(order, "a", 1)).toBe("b");
    expect(stepThread(order, "c", 1)).toBe("a");
    expect(stepThread(order, "a", -1)).toBe("c");
  });

  test("starts at an end when the open thread isn't listed", () => {
    expect(stepThread(order, undefined, 1)).toBe("a");
    expect(stepThread(order, "x", -1)).toBe("c");
    expect(stepThread([], "a", 1)).toBeUndefined();
  });
});
