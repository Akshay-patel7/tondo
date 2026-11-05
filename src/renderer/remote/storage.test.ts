import { afterEach, expect, it, vi } from "vitest";
import {
  clearBrowserDraft,
  forgetThread,
  readBrowserDraft,
  rememberedThread,
  rememberThread,
  saveBrowserDraft,
} from "./storage";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}

function blocked(): never {
  throw new Error("Storage unavailable");
}

afterEach(() => vi.unstubAllGlobals());

it("keeps drafts and navigation in their separate browser stores", () => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  expect(saveBrowserDraft("draft", "phone only")).toBe(true);
  expect(readBrowserDraft("draft")).toBe("phone only");
  rememberThread("thread");
  expect(rememberedThread()).toBe("thread");
  expect(localStorage.getItem("tondo:remote-thread")).toBeNull();
  expect(sessionStorage.getItem("draft")).toBeNull();
  forgetThread();
  expect(rememberedThread()).toBeNull();
  clearBrowserDraft("draft");
  expect(readBrowserDraft("draft")).toBe("");
});

it("does not crash or claim persistence when storage is full or blocked", () => {
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
  vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
  expect(readBrowserDraft("draft")).toBe("");
  expect(saveBrowserDraft("draft", "keep in editor")).toBe(false);
  expect(() => clearBrowserDraft("draft")).not.toThrow();
  expect(rememberedThread()).toBeNull();
  expect(() => rememberThread("thread")).not.toThrow();
  expect(() => forgetThread()).not.toThrow();
});
