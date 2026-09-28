import { describe, expect, test } from "vitest";
import { composerAction, type ComposerState, type KeyPress } from "./keys";

function press(key: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...modifiers,
  };
}

const idle: ComposerState = { working: false, queued: false };
const working: ComposerState = { working: true, queued: false };
const queued: ComposerState = { working: true, queued: true };

describe("composerAction", () => {
  test("Enter sends and Alt+Enter follows up, whether pi works or not", () => {
    for (const state of [idle, working]) {
      expect(composerAction(press("Enter"), state)).toBe("send");
      expect(composerAction(press("Enter", { altKey: true }), state)).toBe("follow-up");
    }
  });

  test("leaves Shift+Enter to the textarea, which adds a line", () => {
    expect(composerAction(press("Enter", { shiftKey: true }), working)).toBeNull();
    expect(composerAction(press("Enter", { altKey: true, shiftKey: true }), working)).toBeNull();
  });

  test("leaves Enter alone while an input method is composing", () => {
    expect(composerAction(press("Enter", { isComposing: true }), idle)).toBeNull();
  });

  test("leaves shortcuts with Ctrl or Cmd alone", () => {
    expect(composerAction(press("Enter", { metaKey: true }), idle)).toBeNull();
    expect(composerAction(press("Enter", { ctrlKey: true }), idle)).toBeNull();
  });

  test("Escape stops pi only while it works", () => {
    expect(composerAction(press("Escape"), working)).toBe("stop");
    expect(composerAction(press("Escape"), idle)).toBeNull();
  });

  test("Alt+Up takes the queue back only when something is queued", () => {
    expect(composerAction(press("ArrowUp", { altKey: true }), queued)).toBe("dequeue");
    expect(composerAction(press("ArrowUp", { altKey: true }), working)).toBeNull();
    expect(composerAction(press("ArrowUp"), queued)).toBeNull();
  });
});
