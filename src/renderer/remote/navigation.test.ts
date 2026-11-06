import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  showRemoteThread,
  showRemoteThreads,
  startRemoteNavigation,
  useRemoteLocation,
} from "./navigation";

let entries: unknown[];
let index: number;
let windowStub: EventTarget & { history: History };
let remembered: string | null;

beforeEach(() => {
  entries = [null];
  index = 0;
  remembered = null;
  const events = new EventTarget();
  const history = {
    get state() {
      return entries[index];
    },
    replaceState: vi.fn((state: unknown) => {
      entries[index] = state;
    }),
    pushState: vi.fn((state: unknown) => {
      entries.splice(++index, entries.length, state);
    }),
    back: vi.fn(() => {
      if (index === 0) throw new Error("Navigation would leave Tondo");
      index--;
      events.dispatchEvent(new Event("popstate"));
    }),
    forward: () => {
      if (index + 1 >= entries.length) return;
      index++;
      events.dispatchEvent(new Event("popstate"));
    },
  };
  windowStub = Object.assign(events, { history: history as unknown as History });
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("sessionStorage", { getItem: () => remembered });
  useRemoteLocation.setState({ threadId: null });
});

afterEach(() => vi.unstubAllGlobals());

it("keeps a list entry behind a selected thread and restores it with browser Back/Forward", () => {
  const open = vi.fn();
  startRemoteNavigation(open);
  showRemoteThread("a");
  expect(useRemoteLocation.getState().threadId).toBe("a");
  windowStub.history.back();
  expect(useRemoteLocation.getState().threadId).toBeNull();
  expect(open).not.toHaveBeenCalled();
  windowStub.history.forward();
  expect(useRemoteLocation.getState().threadId).toBe("a");
  expect(open).toHaveBeenLastCalledWith("a");
});

it("gives restored sessions the same Back behavior on a fresh visit", () => {
  remembered = "restored";
  startRemoteNavigation(vi.fn());
  expect(useRemoteLocation.getState().threadId).toBe("restored");
  expect(entries).toHaveLength(2);
  showRemoteThreads();
  expect(index).toBe(0);
  expect(useRemoteLocation.getState().threadId).toBeNull();
});

it("preserves a reloaded list instead of automatically reopening the previous thread", () => {
  remembered = "previous";
  entries[0] = { tondoRemote: true, threadId: null };
  startRemoteNavigation(vi.fn());
  expect(useRemoteLocation.getState().threadId).toBeNull();
  expect(entries).toHaveLength(1);
});

it("does not insert duplicate history entries on reload or reselecting the same thread", () => {
  entries = [
    { tondoRemote: true, threadId: null },
    { tondoRemote: true, threadId: "a" },
  ];
  index = 1;
  startRemoteNavigation(vi.fn());
  showRemoteThread("a");
  expect(entries).toHaveLength(2);
  expect(windowStub.history.pushState).not.toHaveBeenCalled();
  showRemoteThreads();
  expect(index).toBe(0);
});

it("ignores unrelated or malformed history state", () => {
  entries[0] = { tondoRemote: true, threadId: 42 };
  startRemoteNavigation(vi.fn());
  expect(useRemoteLocation.getState().threadId).toBeNull();
  expect(entries[0]).toEqual({ tondoRemote: true, threadId: null });
});
