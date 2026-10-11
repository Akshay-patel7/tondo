import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../shared/settings";
import { useHost } from "./connection";
import { appCommand, shortcutLabel, shortcutLabelFor, type KeyChord } from "./shortcuts";

function bind(shortcuts: AppSettings["shortcuts"]): void {
  useHost.setState({ settings: { ...DEFAULT_SETTINGS, shortcuts } });
}

afterEach(() => {
  useHost.setState({ settings: null });
});

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

  test("opens the settings with mod and the comma", () => {
    expect(appCommand(press(",", "Comma", { metaKey: true }), mac)).toEqual({ type: "settings" });
  });

  test("follows a binding you set, and frees the default", () => {
    bind({ palette: "mod+shift+p" });
    expect(appCommand(press("P", "KeyP", { metaKey: true, shiftKey: true }), mac)).toEqual({
      type: "palette",
    });
    expect(appCommand(press("k", "KeyK", { metaKey: true }), mac)).toBeNull();
  });

  test("ignores a disabled shortcut", () => {
    bind({ "toggle-sidebar": null });
    expect(appCommand(press("b", "KeyB", { metaKey: true }), mac)).toBeNull();
  });

  test("ignores a binding from settings.json without mod, so typing stays typing", () => {
    bind({ palette: "k" });
    expect(appCommand(press("k", "KeyK"), mac)).toBeNull();
    expect(appCommand(press("k", "KeyK", { metaKey: true }), mac)).toBeNull();
    expect(shortcutLabelFor("palette", mac)).toBeNull();
  });

  test("gives a chord two bindings share to the first command only", () => {
    bind({ palette: "mod+n" });
    expect(appCommand(press("n", "KeyN", { metaKey: true }), mac)).toEqual({ type: "palette" });
    expect(shortcutLabelFor("new-thread", mac)).toBeNull();
  });

  test("keeps the thread jumps when a binding takes their keys", () => {
    bind({ settings: "mod+digit1" });
    expect(appCommand(press("1", "Digit1", { metaKey: true }), mac)).toEqual({
      type: "jump-to-thread",
      index: 0,
    });
  });
});

describe("shortcutLabelFor", () => {
  test("labels the default, your binding, or nothing when disabled", () => {
    expect(shortcutLabelFor("settings", mac)).toBe("⌘,");
    expect(shortcutLabelFor("previous-thread", !mac)).toBe("Ctrl+Shift+[");
    bind({ palette: "mod+shift+p", settings: null });
    expect(shortcutLabelFor("palette", mac)).toBe("⌘⇧P");
    expect(shortcutLabelFor("settings", mac)).toBeNull();
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
