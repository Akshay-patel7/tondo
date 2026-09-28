import { describe, expect, it } from "vitest";
import { choosePiToStop, type PoolMember } from "./pool";

const limits = { maxLive: 2, idleMs: 1000 };

const member = (id: string, lastUsed: number, state: Partial<PoolMember> = {}): PoolMember => ({
  id,
  busy: false,
  visible: false,
  lastUsed,
  ...state,
});

describe("choosePiToStop", () => {
  it("stops nothing when there's nothing to stop", () => {
    expect(choosePiToStop([], 0, limits)).toEqual({ stop: [], nextCheckAt: undefined });
  });

  it("stops a hidden thread's pi once it has been idle long enough, and says when the next one would", () => {
    const members = [member("old", 0), member("recent", 500)];
    expect(choosePiToStop(members, 999, limits)).toEqual({ stop: [], nextCheckAt: 1000 });
    expect(choosePiToStop(members, 1000, limits)).toEqual({ stop: ["old"], nextCheckAt: 1500 });
    expect(choosePiToStop(members, 1500, limits)).toEqual({
      stop: ["old", "recent"],
      nextCheckAt: undefined,
    });
  });

  it("stops the least recently used idle threads' pi until at most maxLive run", () => {
    const members = [member("b", 20), member("a", 10), member("c", 30), member("d", 40)];
    expect(choosePiToStop(members, 100, limits)).toEqual({ stop: ["a", "b"], nextCheckAt: 1030 });
  });

  it("never stops the thread on screen or a busy thread, even past the limits", () => {
    const members = [
      member("visible", 0, { visible: true }),
      member("busy", 0, { busy: true }),
      member("both", 0, { visible: true, busy: true }),
    ];
    expect(choosePiToStop(members, 10_000, limits)).toEqual({ stop: [], nextCheckAt: undefined });
  });

  it("lets busy threads take the pool over its limit and stops every idle one then", () => {
    const busy = Array.from({ length: 10 }, (_, i) => member(`busy${i}`, 0, { busy: true }));
    const members = [...busy, member("idle", 50), member("visible", 0, { visible: true })];
    expect(choosePiToStop(members, 100, limits)).toEqual({
      stop: ["idle"],
      nextCheckAt: undefined,
    });
  });
});
