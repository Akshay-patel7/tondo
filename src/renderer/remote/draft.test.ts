import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginRemoteSend,
  editRemoteDraft,
  finishRemoteSend,
  loadRemoteDraft,
  useRemoteDrafts,
} from "./draft";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}
const key = "draft:thread";
let browser: ReturnType<typeof storage>;
beforeEach(() => {
  browser = storage();
  vi.stubGlobal("localStorage", browser);
  useRemoteDrafts.setState(new Map(), true);
});
afterEach(() => vi.unstubAllGlobals());

it("makes submissions atomic and retains pending state across editor remounts", () => {
  loadRemoteDraft(key);
  editRemoteDraft(key, "hello");
  const submitted = beginRemoteSend(key)!;
  expect(beginRemoteSend(key)).toBeNull();
  loadRemoteDraft(key);
  expect(useRemoteDrafts.getState().get(key)?.sending).toBe(true);
  finishRemoteSend(key, submitted.revision, null);
  loadRemoteDraft(key);
  expect(useRemoteDrafts.getState().get(key)).toMatchObject({
    text: "",
    sending: false,
    error: null,
  });
});

it("does not restore stale persisted text after a successful send with full browser storage", () => {
  browser.setItem(key, "Old private draft");
  loadRemoteDraft(key);
  browser.setItem.mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  editRemoteDraft(key, "Send this instead");
  expect(useRemoteDrafts.getState().get(key)?.saved).toBe(false);
  const submitted = beginRemoteSend(key)!;
  // A new snapshot can unmount and recreate the editor before the receipt arrives.
  loadRemoteDraft("another thread");
  loadRemoteDraft(key);
  expect(useRemoteDrafts.getState().get(key)?.text).toBe("Send this instead");
  finishRemoteSend(key, submitted.revision, null);
  loadRemoteDraft(key);
  expect(useRemoteDrafts.getState().get(key)?.text).toBe("");
});

it("preserves newer edits even if they are identical to the submitted text", () => {
  loadRemoteDraft(key);
  editRemoteDraft(key, "same text");
  const submitted = beginRemoteSend(key)!;
  editRemoteDraft(key, "");
  editRemoteDraft(key, "same text");
  finishRemoteSend(key, submitted.revision, null);
  expect(useRemoteDrafts.getState().get(key)?.text).toBe("same text");
});

it("keeps an unconfirmed prompt and its warning across reconnecting snapshots", () => {
  loadRemoteDraft(key);
  editRemoteDraft(key, "Keep until confirmed");
  const submitted = beginRemoteSend(key)!;
  finishRemoteSend(key, submitted.revision, "Connection lost before confirmation");
  loadRemoteDraft(key);
  expect(useRemoteDrafts.getState().get(key)).toMatchObject({
    text: "Keep until confirmed",
    sending: false,
    error: "Connection lost before confirmation",
  });
});

it("bounds the draft cache while retaining in-flight submissions", () => {
  loadRemoteDraft(key);
  editRemoteDraft(key, "pending");
  beginRemoteSend(key);
  for (let i = 0; i < 100; i++) {
    loadRemoteDraft(`thread-${i}`);
    editRemoteDraft(`thread-${i}`, `text ${i}`);
  }
  expect(useRemoteDrafts.getState().size).toBeLessThanOrEqual(64);
  expect(useRemoteDrafts.getState().get(key)?.sending).toBe(true);
});
