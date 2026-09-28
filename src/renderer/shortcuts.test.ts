import { describe, expect, test } from "vitest";
import { appCommand, shortcutLabel, type KeyChord } from "./shortcuts";

function press(key: string, code: string, keys: Partial<KeyChord> = {}): KeyChord {
  return { key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...keys };
}

const mac = true;

describe("appCommand", () => {
  test("reads Command on macOS and Control elsewhere", () => {
    expect(appCommand(press("k", "KeyK", { metaKey: true }), mac)).toEqual({ type: "palette" });
    expect(appCommand(press("k", "KeyK", { ctrlKey: true }), mac)).toBeNull();
    expect(appCommand(press("k", "KeyK", { ctrlKey: true }), !mac)).toEqual({ type: "palette" });
    expect(appCommand(press("k", "KeyK", { metaKey: true }), !mac)).toBeNull();
  });

  test("maps each letter shortcut", () => {
    const mod = { metaKey: true };
    expect(appCommand(press("b", "KeyB", mod), mac)).toEqual({ type: "sidebar" });
    expect(appCommand(press("n", "KeyN", mod), mac)).toEqual({ type: "new-thread" });
    expect(appCommand(press("o", "KeyO", mod), mac)).toEqual({ type: "add-project" });
    expect(appCommand(press("x", "KeyX", mod), mac)).toBeNull();
  });

  test("reads letters from the key, so other keyboard layouts work", () => {
    expect(appCommand(press("k", "KeyV", { metaKey: true }), mac)).toEqual({ type: "palette" });
  });

  test("moves between threads with Shift and the brackets", () => {
    const mod = { metaKey: true, shiftKey: true };
    expect(appCommand(press("{", "BracketLeft", mod), mac)).toEqual({
      type: "step-thread",
      step: -1,
    });
    expect(appCommand(press("}", "BracketRight", mod), mac)).toEqual({
      type: "step-thread",
      step: 1,
    });
    expect(appCommand(press("K", "KeyK", mod), mac)).toBeNull();
  });

  test("jumps to the first nine threads with the digits", () => {
    const mod = { metaKey: true };
    expect(appCommand(press("1", "Digit1", mod), mac)).toEqual({
      type: "jump-to-thread",
      index: 0,
    });
    expect(appCommand(press("9", "Digit9", mod), mac)).toEqual({
      type: "jump-to-thread",
      index: 8,
    });
    expect(appCommand(press("0", "Digit0", mod), mac)).toBeNull();
  });

  test("leaves presses with Alt or without mod alone", () => {
    expect(appCommand(press("k", "KeyK"), mac)).toBeNull();
    expect(appCommand(press("k", "KeyK", { metaKey: true, altKey: true }), mac)).toBeNull();
    expect(appCommand(press("k", "KeyK", { metaKey: true, ctrlKey: true }), mac)).toBeNull();
  });
});

describe("shortcutLabel", () => {
  test("uses symbols on macOS and words elsewhere", () => {
    expect(shortcutLabel("K", mac)).toBe("⌘K");
    expect(shortcutLabel("]", mac, true)).toBe("⌘⇧]");
    expect(shortcutLabel("K", !mac)).toBe("Ctrl+K");
    expect(shortcutLabel("]", !mac, true)).toBe("Ctrl+Shift+]");
  });
});
