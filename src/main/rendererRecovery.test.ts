import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadWhenRendererDies } from "./rendererRecovery";

/** Stands in for the window's page. `die` reports its renderer gone. */
function watchPage({ destroyed = false } = {}) {
  const page = Object.assign(new EventEmitter(), {
    reload: vi.fn(),
    isDestroyed: () => destroyed,
  });
  reloadWhenRendererDies(page as unknown as WebContents);
  return {
    reload: page.reload,
    die: (reason: string) => page.emit("render-process-gone", {}, { reason, exitCode: 1 }),
  };
}

describe("reloadWhenRendererDies", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reloads the page when its renderer dies", () => {
    const { reload, die } = watchPage();
    die("crashed");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a renderer that exited cleanly, and a window that's gone", () => {
    const clean = watchPage();
    clean.die("clean-exit");
    expect(clean.reload).not.toHaveBeenCalled();
    const destroyed = watchPage({ destroyed: true });
    destroyed.die("crashed");
    expect(destroyed.reload).not.toHaveBeenCalled();
  });

  it("reloads at most three times a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { reload, die } = watchPage();
    for (let crash = 0; crash < 4; crash++) die("oom");
    expect(reload).toHaveBeenCalledTimes(3);
    vi.setSystemTime(59_999);
    die("oom");
    expect(reload).toHaveBeenCalledTimes(3);
    vi.setSystemTime(60_000);
    die("oom");
    expect(reload).toHaveBeenCalledTimes(4);
  });
});
