// Tondo's own settings as the page sees them. The host reads and writes them
// in settings.json in the app data folder, and checks every change.

export type ThemeSetting = "system" | "light" | "dark";

export const THEME_SETTINGS: readonly ThemeSetting[] = ["system", "light", "dark"];

/**
 * The colors Tondo draws with, each in a light and a dark version. The theme
 * picks the version, so the two settings never change each other.
 */
export const PALETTE_SETTINGS = ["default", "slate", "ocean", "rose"] as const;

export type PaletteSetting = (typeof PALETTE_SETTINGS)[number];

/** The app commands you can bind to a shortcut. */
export const SHORTCUT_COMMANDS = [
  "palette",
  "new-thread",
  "add-project",
  "toggle-sidebar",
  "previous-thread",
  "next-thread",
  "settings",
] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

/** What each command is called in the settings and in problems. */
export const SHORTCUT_TITLES: Readonly<Record<ShortcutCommand, string>> = {
  palette: "Command palette",
  "new-thread": "New thread",
  "add-project": "Add project",
  "toggle-sidebar": "Toggle sidebar",
  "previous-thread": "Previous thread",
  "next-thread": "Next thread",
  settings: "Settings",
};

export interface PoolSettings {
  /** How many pi processes may run at once. */
  readonly maxLive: number;
  /** How long an idle thread's pi keeps running once you leave the thread. */
  readonly idleMinutes: number;
}

/** The smallest and largest value each pool setting takes. */
export const POOL_RANGES: Readonly<
  Record<keyof PoolSettings, { readonly min: number; readonly max: number }>
> = {
  maxLive: { min: 1, max: 12 },
  idleMinutes: { min: 1, max: 240 },
};

export interface PanelWidths {
  readonly sidebar: number;
  readonly changes: number;
}

export const PANEL_WIDTH_RANGES: Readonly<
  Record<keyof PanelWidths, { readonly min: number; readonly max: number }>
> = {
  sidebar: { min: 200, max: 480 },
  changes: { min: 280, max: 800 },
};

/** Whether a saved panel width is a whole number within its limits. */
export function isPanelWidth(key: keyof PanelWidths, value: unknown): value is number {
  const { min, max } = PANEL_WIDTH_RANGES[key];
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

export interface AppSettings {
  /** The pi command to run, or null to find pi on PATH. */
  readonly piPath: string | null;
  readonly theme: ThemeSetting;
  readonly palette: PaletteSetting;
  /** Whether thinking sections start expanded. Each section can still be toggled. */
  readonly expandThinking: boolean;
  readonly pool: PoolSettings;
  /** Preferred CSS-pixel widths. Small windows can temporarily narrow the panels. */
  readonly panelWidths: PanelWidths;
  /** Chord text by command. null disables a shortcut, and a missing command keeps its default. */
  readonly shortcuts: Readonly<Partial<Record<ShortcutCommand, string | null>>>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  piPath: null,
  theme: "system",
  // The warm palette Tondo had before there were others.
  palette: "default",
  expandThinking: false,
  pool: { maxLive: 4, idleMinutes: 10 },
  panelWidths: { sidebar: 256, changes: 432 },
  shortcuts: {},
};

/** A change to the settings. Only the fields present change. */
export interface SettingsPatch {
  readonly theme?: ThemeSetting;
  readonly palette?: PaletteSetting;
  readonly expandThinking?: boolean;
  readonly pool?: Partial<PoolSettings>;
  readonly panelWidths?: Partial<PanelWidths>;
  /** "default" removes your binding, so the command gets its default again. */
  readonly shortcuts?: Partial<Record<ShortcutCommand, string | null | "default">>;
  /** null goes back to finding pi on PATH. */
  readonly piPath?: string | null;
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return THEME_SETTINGS.some((theme) => theme === value);
}

export function isPaletteSetting(value: unknown): value is PaletteSetting {
  return PALETTE_SETTINGS.some((palette) => palette === value);
}

export function isShortcutCommand(value: unknown): value is ShortcutCommand {
  return SHORTCUT_COMMANDS.some((command) => command === value);
}

/** Whether `value` is a whole number the pool setting `key` accepts. */
export function isPoolValue(key: keyof PoolSettings, value: unknown): value is number {
  const { min, max } = POOL_RANGES[key];
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
