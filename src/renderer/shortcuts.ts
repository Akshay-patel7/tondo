// Tondo's app shortcuts: the defaults in src/shared/shortcuts.ts, changed by
// your settings. mod is Command on macOS and Control elsewhere. mod+1 to
// mod+9 open the sidebar's threads and can't be changed.
import { SHORTCUT_COMMANDS, type ShortcutCommand } from "../shared/settings";
import { checkShortcuts, chordFromKeyEvent, chordLabel, formatChord } from "../shared/shortcuts";
import { useHost } from "./connection";

export type AppCommand =
  | { readonly type: "palette" }
  | { readonly type: "sidebar" }
  | { readonly type: "new-thread" }
  | { readonly type: "add-project" }
  | { readonly type: "settings" }
  | { readonly type: "step-thread"; readonly step: 1 | -1 }
  /** Opens the sidebar's thread at `index`, counting from 0. */
  | { readonly type: "jump-to-thread"; readonly index: number };

export interface KeyChord {
  readonly key: string;
  /** The physical key, which Shift doesn't change: "BracketLeft", "Digit1". */
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

const COMMANDS: Readonly<Record<ShortcutCommand, AppCommand>> = {
  palette: { type: "palette" },
  "new-thread": { type: "new-thread" },
  "add-project": { type: "add-project" },
  "toggle-sidebar": { type: "sidebar" },
  "previous-thread": { type: "step-thread", step: -1 },
  "next-thread": { type: "step-thread", step: 1 },
  settings: { type: "settings" },
};

/**
 * Each command's chord, read from the settings on every call so changes apply
 * at once. A binding from settings.json that can't work, such as one without
 * mod that would take a letter from the composer, is off.
 */
function currentShortcuts() {
  return checkShortcuts(useHost.getState().settings?.shortcuts ?? {}).usable;
}

/** The app command `press` runs, or null if it isn't a shortcut. */
export function appCommand(press: KeyChord, isMac: boolean): AppCommand | null {
  const chord = chordFromKeyEvent(press, isMac);
  if (chord === null) return null;
  const pressed = formatChord(chord);
  const digit = /^mod\+digit([1-9])$/.exec(pressed);
  if (digit) return { type: "jump-to-thread", index: Number(digit[1]) - 1 };
  const shortcuts = currentShortcuts();
  const command = SHORTCUT_COMMANDS.find((name) => {
    const bound = shortcuts[name];
    return bound !== null && formatChord(bound) === pressed;
  });
  return command === undefined ? null : COMMANDS[command];
}

/** How `command`'s shortcut reads on this platform, or null if it's disabled. */
export function shortcutLabelFor(command: ShortcutCommand, isMac: boolean): string | null {
  const chord = currentShortcuts()[command];
  return chord === null ? null : chordLabel(chord, isMac);
}

/** How a shortcut reads on this platform: ⌘K on macOS, Ctrl+K elsewhere. */
export function shortcutLabel(key: string, isMac: boolean, shift = false): string {
  if (isMac) return `⌘${shift ? "⇧" : ""}${key}`;
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
