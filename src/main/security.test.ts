import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hardenWebContents } from "./security";

const APP = "tondo://app/";

function hardenedPage() {
  const page = Object.assign(new EventEmitter(), {
    loadURL: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  hardenWebContents(page as unknown as WebContents, (url) => url.startsWith(APP));
  return {
    loadURL: page.loadURL,
    stop: page.stop,
    startNavigation: (url: string) =>
      page.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false }),
    commit: (url: string) => page.emit("did-navigate", {}, url),
  };
}

describe("hardenWebContents", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the app again when the page commits about:blank", () => {
    const { loadURL, commit } = hardenedPage();
    commit(APP);
    commit("about:blank");
    expect(loadURL).toHaveBeenCalledExactlyOnceWith(APP);
  });

  it.each(["about:blank", "https://example.com/elsewhere"])(
    "does not stop the contents while navigation to %s starts",
    (url) => {
      const { loadURL, stop, startNavigation, commit } = hardenedPage();
      commit(APP);
      startNavigation(url);
      expect(stop).not.toHaveBeenCalled();
      expect(loadURL).not.toHaveBeenCalled();
    },
  );

  it("leaves navigation inside the app alone", () => {
    const { loadURL, commit } = hardenedPage();
    commit(APP);
    commit(`${APP}index.html`);
    expect(loadURL).not.toHaveBeenCalled();
  });

  it("leaves pages that never showed the app, like DevTools, alone", () => {
    const { loadURL, commit } = hardenedPage();
    commit("devtools://devtools/bundled/devtools_app.html");
    commit("about:blank");
    expect(loadURL).not.toHaveBeenCalled();
  });
});
