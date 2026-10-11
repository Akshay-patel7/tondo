import { describe, expect, it } from "vitest";
import { SHORTCUT_COMMANDS } from "./settings";
import {
  checkShortcuts,
  chordFromKeyEvent,
  chordLabel,
  DEFAULT_SHORTCUTS,
  formatChord,
  parseChord,
  resolveShortcuts,
  shortcutProblems,
  type KeyPress,
} from "./shortcuts";

const mac = true;

function press(key: string, code: string, keys: Partial<KeyPress> = {}): KeyPress {
  return { key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...keys };
}

describe("parseChord and formatChord", () => {
  it.each([
    ["mod+k", "mod+k"],
    ["shift+mod+bracketleft", "mod+shift+bracketleft"],
    ["Alt+Shift+Mod+F12", "mod+alt+shift+f12"],
    ["mod+digit0", "mod+digit0"],
    ["mod+arrowup", "mod+arrowup"],
    ["comma", "comma"],
  ])("reads %s and writes it as %s", (text, canonical) => {
    const chord = parseChord(text);
    expect(chord).not.toBeNull();
    expect(formatChord(chord!)).toBe(canonical);
    expect(parseChord(canonical)).toEqual(chord);
  });

  it.each([
    "",
    "mod",
    "mod+",
    "mod+mod+k",
    "k+mod",
    "mod+ctrl+k",
    "mod+f13",
    "mod+kk",
    "mod+escape",
  ])("rejects %j", (text) => {
    expect(parseChord(text)).toBeNull();
  });
});

const labels = (isMac: boolean) =>
  SHORTCUT_COMMANDS.map((command) => chordLabel(parseChord(DEFAULT_SHORTCUTS[command])!, isMac));

describe("chordLabel", () => {
  it("labels the defaults as today's shortcutLabel does", () => {
    expect(labels(mac)).toEqual(["⌘K", "⌘N", "⌘O", "⌘B", "⌘⇧[", "⌘⇧]", "⌘,"]);
    expect(labels(!mac)).toEqual([
      "Ctrl+K",
      "Ctrl+N",
      "Ctrl+O",
      "Ctrl+B",
      "Ctrl+Shift+[",
      "Ctrl+Shift+]",
      "Ctrl+,",
    ]);
  });

  it("puts Alt between mod and Shift", () => {
    const chord = parseChord("mod+alt+shift+arrowleft")!;
    expect(chordLabel(chord, mac)).toBe("⌘⌥⇧←");
    expect(chordLabel(chord, !mac)).toBe("Ctrl+Alt+Shift+Left");
  });

  it("asks for ↩'s text glyph on macOS", () => {
    const chord = parseChord("alt+enter")!;
    expect(chordLabel(chord, mac)).toBe("⌥↩\uFE0E");
    expect(chordLabel(chord, !mac)).toBe("Alt+Enter");
  });
});

describe("chordFromKeyEvent", () => {
  it("reads Command on macOS and Control elsewhere", () => {
    expect(chordFromKeyEvent(press("k", "KeyK", { metaKey: true }), mac)).toEqual(
      parseChord("mod+k"),
    );
    expect(chordFromKeyEvent(press("k", "KeyK", { ctrlKey: true }), !mac)).toEqual(
      parseChord("mod+k"),
    );
    expect(chordFromKeyEvent(press("k", "KeyK", { ctrlKey: true, metaKey: true }), mac)).toBeNull();
    expect(chordFromKeyEvent(press("k", "KeyK", { metaKey: true }), !mac)).toBeNull();
  });

  it("reads letters from the key, so other keyboard layouts work", () => {
    expect(chordFromKeyEvent(press("k", "KeyV", { metaKey: true }), mac)).toEqual(
      parseChord("mod+k"),
    );
    expect(chordFromKeyEvent(press("K", "KeyK", { metaKey: true, shiftKey: true }), mac)).toEqual(
      parseChord("mod+shift+k"),
    );
  });

  it("reads brackets, digits and the comma from the code, which Shift doesn't change", () => {
    const shifted = { metaKey: true, shiftKey: true };
    expect(chordFromKeyEvent(press("{", "BracketLeft", shifted), mac)).toEqual(
      parseChord(DEFAULT_SHORTCUTS["previous-thread"]),
    );
    expect(chordFromKeyEvent(press("}", "BracketRight", shifted), mac)).toEqual(
      parseChord(DEFAULT_SHORTCUTS["next-thread"]),
    );
    expect(chordFromKeyEvent(press("!", "Digit1", shifted), mac)).toEqual(
      parseChord("mod+shift+digit1"),
    );
    expect(chordFromKeyEvent(press(",", "Comma", { metaKey: true }), mac)).toEqual(
      parseChord(DEFAULT_SHORTCUTS.settings),
    );
  });

  it("reads a letter from its code when Alt changes the character on macOS", () => {
    expect(chordFromKeyEvent(press("˚", "KeyK", { metaKey: true, altKey: true }), mac)).toEqual(
      parseChord("mod+alt+k"),
    );
  });

  it("names nothing for a modifier alone or a key it doesn't know", () => {
    expect(chordFromKeyEvent(press("Meta", "MetaLeft", { metaKey: true }), mac)).toBeNull();
    expect(chordFromKeyEvent(press("Escape", "Escape", { metaKey: true }), mac)).toBeNull();
  });
});

describe("resolveShortcuts", () => {
  it("takes your bindings over the defaults, and null disables one", () => {
    const resolved = resolveShortcuts({ palette: "mod+shift+p", settings: null });
    expect(resolved.palette).toEqual(parseChord("mod+shift+p"));
    expect(resolved.settings).toBeNull();
    expect(resolved["new-thread"]).toEqual(parseChord("mod+n"));
  });
});

describe("checkShortcuts", () => {
  it("turns off a binding without mod or a reserved one, and says why on its row", () => {
    const { usable, problems } = checkShortcuts({ palette: "k", settings: "mod+c" });
    expect(usable.palette).toBeNull();
    expect(usable.settings).toBeNull();
    expect(usable["new-thread"]).toEqual(parseChord("mod+n"));
    expect(problems.palette).toEqual([
      "Command palette's shortcut k needs mod, which is Cmd or Ctrl.",
    ]);
    expect(problems.settings).toEqual(["Settings's shortcut mod+c is kept for copy."]);
    expect(problems["new-thread"]).toEqual([]);
  });

  it("leaves a shared chord with the first command, and flags both rows", () => {
    const { usable, problems } = checkShortcuts({ palette: "mod+n" });
    expect(usable.palette).toEqual(parseChord("mod+n"));
    expect(usable["new-thread"]).toBeNull();
    const clash = "New thread and Command palette both use mod+n.";
    expect(problems.palette).toEqual([clash]);
    expect(problems["new-thread"]).toEqual([clash]);
    expect(shortcutProblems({ palette: "mod+n" })).toEqual([clash]);
  });

  it("finds nothing wrong with the defaults", () => {
    const { usable, problems } = checkShortcuts({});
    expect(usable).toEqual(resolveShortcuts({}));
    expect(Object.values(problems).flat()).toEqual([]);
  });
});

describe("shortcutProblems", () => {
  it("finds none in the defaults", () => {
    expect(shortcutProblems({})).toEqual([]);
  });

  it("names two commands that use the same chord", () => {
    expect(shortcutProblems({ palette: "shift+mod+p", settings: "mod+shift+p" })).toEqual([
      "Settings and Command palette both use mod+shift+p.",
    ]);
  });

  it("names a binding that clashes with a default", () => {
    expect(shortcutProblems({ settings: "mod+k" })).toEqual([
      "Settings and Command palette both use mod+k.",
    ]);
    expect(shortcutProblems({ settings: "mod+k", palette: null })).toEqual([]);
  });

  it.each([
    ["mod+digit1", "opening thread 1"],
    ["mod+digit9", "opening thread 9"],
    ["mod+c", "copy"],
    ["mod+v", "paste"],
    ["mod+x", "cut"],
    ["mod+a", "select all"],
    ["mod+z", "undo"],
    ["mod+shift+z", "redo"],
    ["mod+q", "quit"],
    ["mod+w", "close the window"],
    ["mod+r", "reload"],
  ])("refuses the reserved %s", (text, use) => {
    expect(shortcutProblems({ palette: text })).toEqual([
      `Command palette's shortcut ${text} is kept for ${use}.`,
    ]);
  });

  it("refuses a chord without mod", () => {
    expect(shortcutProblems({ "toggle-sidebar": "shift+f5" })).toEqual([
      "Toggle sidebar's shortcut shift+f5 needs mod, which is Cmd or Ctrl.",
    ]);
  });
});
