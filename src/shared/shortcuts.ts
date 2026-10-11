// Tondo's app shortcuts as text you can change in the settings: "mod+shift+k".
// mod is Command on macOS and Control elsewhere. The defaults follow T3 Code's
// (DEFAULT_KEYBINDINGS in packages/shared/src/keybindings.ts), with mod+O to
// add a project.
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_TITLES,
  type AppSettings,
  type ShortcutCommand,
} from "./settings";

export interface Chord {
  /** A key token: "k", "digit1", "bracketleft", "comma", "f5", "arrowup"... */
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutCommand, string>> = {
  palette: "mod+k",
  "new-thread": "mod+n",
  "add-project": "mod+o",
  "toggle-sidebar": "mod+b",
  "previous-thread": "mod+shift+bracketleft",
  "next-thread": "mod+shift+bracketright",
  settings: "mod+comma",
};

/** Keys other than letters, by token: the KeyboardEvent code, then how macOS and the rest label them. */
const KEYS: Readonly<Record<string, readonly [code: string, mac: string, other: string]>> = {
  comma: ["Comma", ",", ","],
  period: ["Period", ".", "."],
  slash: ["Slash", "/", "/"],
  semicolon: ["Semicolon", ";", ";"],
  quote: ["Quote", "'", "'"],
  bracketleft: ["BracketLeft", "[", "["],
  bracketright: ["BracketRight", "]", "]"],
  backslash: ["Backslash", "\\", "\\"],
  minus: ["Minus", "-", "-"],
  equal: ["Equal", "=", "="],
  backquote: ["Backquote", "`", "`"],
  // U+FE0E asks for the text glyph. Chromium on macOS draws a bare ↩ as an emoji.
  enter: ["Enter", "↩\uFE0E", "Enter"],
  space: ["Space", "Space", "Space"],
  arrowup: ["ArrowUp", "↑", "Up"],
  arrowdown: ["ArrowDown", "↓", "Down"],
  arrowleft: ["ArrowLeft", "←", "Left"],
  arrowright: ["ArrowRight", "→", "Right"],
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [
      `digit${digit}`,
      [`Digit${digit}`, `${digit}`, `${digit}`],
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, [`F${i + 1}`, `F${i + 1}`, `F${i + 1}`]]),
  ),
};

const KEY_BY_CODE = new Map(Object.entries(KEYS).map(([token, [code]]) => [code, token]));

const MODIFIERS = ["mod", "alt", "shift"] as const;

/** Copy, paste, undo, quit and the like, and mod+1 to mod+9, which open the sidebar's threads. */
const RESERVED: Readonly<Record<string, string>> = {
  "mod+c": "copy",
  "mod+v": "paste",
  "mod+x": "cut",
  "mod+a": "select all",
  "mod+z": "undo",
  "mod+shift+z": "redo",
  "mod+q": "quit",
  "mod+w": "close the window",
  "mod+r": "reload",
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`mod+digit${i + 1}`, `opening thread ${i + 1}`]),
  ),
};

function isKeyToken(token: string): boolean {
  return /^[a-z]$/.test(token) || Object.hasOwn(KEYS, token);
}

/** The chord `text` names, or null if it isn't one. Modifiers come in any order before the key. */
export function parseChord(text: string): Chord | null {
  const tokens = text.trim().toLowerCase().split("+");
  const key = tokens.pop();
  if (key === undefined || !isKeyToken(key)) return null;
  const modifiers = new Set(tokens);
  if (
    modifiers.size !== tokens.length ||
    tokens.some((token) => !MODIFIERS.some((modifier) => modifier === token))
  )
    return null;
  return {
    key,
    mod: modifiers.has("mod"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
  };
}

/** The chord's canonical text, with its modifiers in the order mod, alt, shift. */
export function formatChord(chord: Chord): string {
  return [...MODIFIERS.filter((modifier) => chord[modifier]), chord.key].join("+");
}

/** How the chord reads on this platform: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. */
export function chordLabel(chord: Chord, isMac: boolean): string {
  const named = KEYS[chord.key];
  const key = named ? named[isMac ? 1 : 2] : chord.key.toUpperCase();
  if (isMac) return `${chord.mod ? "⌘" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${key}`;
  return [chord.mod && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", key]
    .filter(Boolean)
    .join("+");
}

export interface KeyPress {
  readonly key: string;
  /** The physical key, which Shift doesn't change: "BracketLeft", "Digit1". */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The chord `event` presses, or null if it presses no key a chord can name.
 * Letters come from the key, so other keyboard layouts work, and every other
 * key from its code, which Shift doesn't change. Control on macOS and the
 * Windows key elsewhere aren't part of any chord.
 */
export function chordFromKeyEvent(event: KeyPress, isMac: boolean): Chord | null {
  if (isMac ? event.ctrlKey : event.metaKey) return null;
  const letter = event.key.toLowerCase();
  // Alt turns a letter into another character on macOS, so its code names it then.
  const altLetter = event.altKey ? /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase() : undefined;
  const key = /^[a-z]$/.test(letter) ? letter : (altLetter ?? KEY_BY_CODE.get(event.code));
  if (key === undefined) return null;
  return {
    key,
    mod: isMac ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/** Each command's chord: your binding if you set one, else the default. null: disabled. */
export function resolveShortcuts(
  overrides: AppSettings["shortcuts"],
): Readonly<Record<ShortcutCommand, Chord | null>> {
  return Object.fromEntries(
    SHORTCUT_COMMANDS.map((command) => {
      const text = overrides[command];
      return [command, text === null ? null : parseChord(text ?? DEFAULT_SHORTCUTS[command])];
    }),
  ) as Record<ShortcutCommand, Chord | null>;
}

export interface ShortcutCheck {
  /**
   * Each command's chord, or null if it's disabled or its binding can't work:
   * no mod, a reserved chord, or one an earlier command already uses.
   */
  readonly usable: Readonly<Record<ShortcutCommand, Chord | null>>;
  /** What's wrong with each command's binding. Two commands on one chord both get the sentence. */
  readonly problems: Readonly<Record<ShortcutCommand, readonly string[]>>;
}

/**
 * Checks every binding, as a hand-edited settings.json can hold any of them.
 * Of two commands on one chord, the first in SHORTCUT_COMMANDS keeps it.
 */
export function checkShortcuts(overrides: AppSettings["shortcuts"]): ShortcutCheck {
  const usable = {} as Record<ShortcutCommand, Chord | null>;
  const problems = {} as Record<ShortcutCommand, string[]>;
  for (const command of SHORTCUT_COMMANDS) {
    usable[command] = null;
    problems[command] = [];
  }
  const owners = new Map<string, ShortcutCommand>();
  for (const command of SHORTCUT_COMMANDS) {
    const title = SHORTCUT_TITLES[command];
    const text = overrides[command];
    if (text === null) continue;
    const chord = parseChord(text ?? DEFAULT_SHORTCUTS[command]);
    if (chord === null) {
      problems[command].push(
        `${title}'s shortcut ${JSON.stringify(text)} isn't one Tondo understands.`,
      );
      continue;
    }
    const canonical = formatChord(chord);
    const owner = owners.get(canonical);
    if (!chord.mod) {
      problems[command].push(`${title}'s shortcut ${canonical} needs mod, which is Cmd or Ctrl.`);
    } else if (Object.hasOwn(RESERVED, canonical)) {
      problems[command].push(
        `${title}'s shortcut ${canonical} is kept for ${RESERVED[canonical]}.`,
      );
    } else if (owner !== undefined) {
      const problem = `${title} and ${SHORTCUT_TITLES[owner]} both use ${canonical}.`;
      problems[command].push(problem);
      problems[owner].push(problem);
    } else {
      owners.set(canonical, command);
      usable[command] = chord;
    }
  }
  return { usable, problems };
}

/** What's wrong with these bindings, one sentence each. Empty when they all work. */
export function shortcutProblems(overrides: AppSettings["shortcuts"]): string[] {
  const { problems } = checkShortcuts(overrides);
  return [...new Set(SHORTCUT_COMMANDS.flatMap((command) => problems[command]))];
}
