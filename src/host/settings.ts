// Tondo's own settings, in settings.json in the app data folder. The host is
// the only process that reads or writes it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  isPaletteSetting,
  isPoolValue,
  isShortcutCommand,
  isThemeSetting,
  POOL_RANGES,
  type AppSettings,
  type SettingsPatch,
  type ShortcutCommand,
} from "../shared/settings";
import { formatChord, parseChord, shortcutProblems } from "../shared/shortcuts";
import { canonical } from "./trust";

export interface Settings extends AppSettings {
  /** Your answers to whether to trust a project, by the project folder's realpath. */
  readonly projectTrust: Readonly<Record<string, boolean>>;
}

/** The settings a missing file holds. */
const DEFAULTS: Settings = { ...DEFAULT_SETTINGS, projectTrust: {} };

/** Reads the settings in `file`, with defaults for what it leaves out. A missing file holds the defaults. */
export function readSettings(file: string): Settings {
  return check(readObject(file), (what) => problem(file, what));
}

/** Settings Tondo can go on with, and what's wrong with the file they came from. */
export interface SettingsRead {
  readonly settings: Settings;
  /** What's wrong with the file, naming it, or null if nothing is. */
  readonly problem: string | null;
}

/**
 * Reads the settings in `file` for starting pi and showing them: each setting
 * the file gets wrong takes its default instead of failing the rest, and a
 * file Tondo can't read at all holds the defaults.
 */
export function readSettingsLeniently(file: string): SettingsRead {
  let saved: Record<string, unknown>;
  try {
    saved = readObject(file);
  } catch (error) {
    return { settings: DEFAULTS, problem: (error as Error).message };
  }
  const problems: string[] = [];
  const settings = parse(saved, (what) => problems.push(what));
  return { settings, problem: problems.length === 0 ? null : problem(file, problems[0]!).message };
}

/**
 * The shortcut problems `patch` brings to the bindings in `saved`. Problems
 * the bindings already had, such as two commands a hand edit gave one chord,
 * don't count against a change that leaves them as they were.
 */
export function newShortcutProblems(
  saved: Settings["shortcuts"],
  patch: NonNullable<SettingsPatch["shortcuts"]>,
): string[] {
  const shortcuts: Record<string, string | null> = { ...saved };
  for (const [command, text] of Object.entries(patch)) {
    if (text === "default") delete shortcuts[command];
    else if (text !== undefined) shortcuts[command] = text;
  }
  const had = new Set(shortcutProblems(saved));
  return shortcutProblems(shortcuts).filter((found) => !had.has(found));
}

/**
 * Applies `patch` to the settings in `file` and returns them. An invalid
 * change throws and leaves the file as it was.
 */
export function updateSettings(file: string, patch: SettingsPatch): Settings {
  return write(file, (saved) => {
    const next: Record<string, unknown> = { ...saved };
    if (patch.theme !== undefined) next.theme = patch.theme;
    if (patch.palette !== undefined) next.palette = patch.palette;
    if (patch.pool !== undefined) {
      next.pool = { ...(isObject(saved.pool) ? saved.pool : {}), ...patch.pool };
    }
    if (patch.shortcuts !== undefined) {
      const shortcuts: Record<string, unknown> = isObject(saved.shortcuts)
        ? { ...saved.shortcuts }
        : {};
      for (const [command, text] of Object.entries(patch.shortcuts)) {
        if (text === "default") delete shortcuts[command];
        else if (text === null) shortcuts[command] = null;
        else {
          const chord = parseChord(text);
          shortcuts[command] = chord ? formatChord(chord) : text;
        }
      }
      next.shortcuts = shortcuts;
    }
    if (patch.piPath === null) delete next.piPath;
    else if (patch.piPath !== undefined) next.piPath = patch.piPath;
    return next;
  });
}

/**
 * Remembers your answer to whether to trust `project`. It keeps everything
 * else in the file, keys this version doesn't know included.
 */
export function saveTrustAnswer(file: string, project: string, trusted: boolean): void {
  write(file, (saved) => ({
    ...saved,
    projectTrust: {
      ...(isObject(saved.projectTrust) ? saved.projectTrust : {}),
      [canonical(project)]: trusted,
    },
  }));
}

/**
 * Writes what `change` makes of the file's object, if it holds valid
 * settings. It keeps keys this version doesn't know, and replaces the file in
 * one step so a crash can't leave half of it.
 */
function write(file: string, change: (saved: Record<string, unknown>) => Record<string, unknown>) {
  const saved = readObject(file);
  const next = change(saved);
  let settings: Settings;
  try {
    settings = check(next, (what) => new Error(`Tondo didn't save that change. It ${what}.`));
  } catch (error) {
    // A file that was already wrong is the problem to report, not the change.
    check(saved, (what) => problem(file, what));
    throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const unfinished = `${file}.${process.pid}.tmp`;
  writeFileSync(unfinished, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(unfinished, file);
  return settings;
}

/** The JSON object in `file`, or an empty one if the file doesn't exist. */
function readObject(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let settings: unknown;
  try {
    // Some editors start a UTF-8 file with a byte order mark, which JSON doesn't allow.
    settings = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  } catch (error) {
    throw problem(file, `isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(settings)) throw problem(file, "isn't a JSON object");
  return settings;
}

/** The settings `saved` holds, or the error `fail` makes of what's wrong with them. */
function check(saved: Record<string, unknown>, fail: (what: string) => Error): Settings {
  return parse(saved, (what) => {
    throw fail(what);
  });
}

/**
 * The settings `saved` holds. `report` hears what's wrong with each setting,
 * which then takes its default. Shortcuts for commands this version doesn't
 * know, which a newer Tondo may have saved, are left out without a word.
 */
function parse(saved: Record<string, unknown>, report: (what: string) => void): Settings {
  const {
    piPath,
    projectTrust = {},
    theme = DEFAULT_SETTINGS.theme,
    // A file from before palettes has none, and keeps the look it had.
    palette = DEFAULT_SETTINGS.palette,
    pool = {},
    shortcuts = {},
  } = saved;
  let pi: string | null = null;
  if (piPath !== undefined) {
    if (typeof piPath === "string" && path.isAbsolute(piPath)) pi = piPath;
    else report(`has a piPath that isn't an absolute path: ${JSON.stringify(piPath)}`);
  }
  const trust: Record<string, boolean> = {};
  if (isObject(projectTrust)) {
    for (const [project, answer] of Object.entries(projectTrust)) {
      if (typeof answer === "boolean") trust[project] = answer;
    }
  }
  if (!isObject(projectTrust) || Object.keys(trust).length !== Object.keys(projectTrust).length) {
    report("has a projectTrust that isn't an object of true and false answers");
  }
  let chosenTheme = DEFAULT_SETTINGS.theme;
  if (isThemeSetting(theme)) chosenTheme = theme;
  else report(`has a theme that isn't system, light or dark: ${JSON.stringify(theme)}`);
  let chosenPalette = DEFAULT_SETTINGS.palette;
  if (isPaletteSetting(palette)) chosenPalette = palette;
  else {
    report(`has a palette that isn't default, slate, ocean or rose: ${JSON.stringify(palette)}`);
  }
  if (!isObject(pool)) report("has a pool that isn't an object");
  const limits = { ...DEFAULT_SETTINGS.pool };
  if (isObject(pool)) {
    for (const key of ["maxLive", "idleMinutes"] as const) {
      const { min, max } = POOL_RANGES[key];
      const value = pool[key] === undefined ? DEFAULT_SETTINGS.pool[key] : pool[key];
      if (isPoolValue(key, value)) limits[key] = value;
      else {
        report(
          `has a pool.${key} that isn't a whole number from ${min} to ${max}: ${JSON.stringify(value)}`,
        );
      }
    }
  }
  const bindings: Partial<Record<ShortcutCommand, string | null>> = {};
  if (!isObject(shortcuts)) report("has shortcuts that aren't an object");
  else {
    for (const [command, text] of Object.entries(shortcuts)) {
      if (!isShortcutCommand(command)) continue;
      if (text === null || (typeof text === "string" && parseChord(text) !== null)) {
        bindings[command] = text;
      } else report(`has a ${command} shortcut that isn't one: ${JSON.stringify(text)}`);
    }
  }
  return {
    piPath: pi,
    theme: chosenTheme,
    palette: chosenPalette,
    pool: limits,
    shortcuts: bindings,
    projectTrust: trust,
  };
}

function problem(file: string, what: string): Error {
  return new Error(`Tondo's settings file ${file} ${what}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
