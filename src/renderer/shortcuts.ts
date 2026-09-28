// Tondo's app shortcuts. They follow T3 Code's defaults
// (DEFAULT_KEYBINDINGS in packages/shared/src/keybindings.ts), with mod+O to
// add a project, and they can't be changed yet. mod is Command on macOS and
// Control elsewhere.

export type AppCommand =
  | { readonly type: "palette" }
  | { readonly type: "sidebar" }
  | { readonly type: "new-thread" }
  | { readonly type: "add-project" }
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

const LETTERS: Record<string, AppCommand> = {
  k: { type: "palette" },
  b: { type: "sidebar" },
  n: { type: "new-thread" },
  o: { type: "add-project" },
};

/** The app command `press` runs, or null if it isn't a shortcut. */
export function appCommand(press: KeyChord, isMac: boolean): AppCommand | null {
  const mod = isMac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!mod || press.altKey) return null;
  if (press.shiftKey) {
    if (press.code === "BracketLeft") return { type: "step-thread", step: -1 };
    if (press.code === "BracketRight") return { type: "step-thread", step: 1 };
    return null;
  }
  const digit = /^Digit([1-9])$/.exec(press.code);
  if (digit) return { type: "jump-to-thread", index: Number(digit[1]) - 1 };
  return LETTERS[press.key.toLowerCase()] ?? null;
}

/** How a shortcut reads on this platform: ⌘K on macOS, Ctrl+K elsewhere. */
export function shortcutLabel(key: string, isMac: boolean, shift = false): string {
  if (isMac) return `⌘${shift ? "⇧" : ""}${key}`;
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
