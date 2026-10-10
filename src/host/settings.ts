// Tondo's own settings, in settings.json in the app data folder. The host is
// the only process that reads or writes it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  isPoolValue,
  isShortcutCommand,
  isThemeSetting,
  POOL_RANGES,
  type AppSettings,
  type SettingsPatch,
} from "../shared/settings";
import { formatChord, parseChord } from "../shared/shortcuts";
import { canonical } from "./trust";

export interface Settings extends AppSettings {
  /** Your answers to whether to trust a project, by the project folder's realpath. */
  readonly projectTrust: Readonly<Record<string, boolean>>;
}

/** Reads the settings in `file`, with defaults for what it leaves out. A missing file holds the defaults. */
export function readSettings(file: string): Settings {
  return check(readObject(file), (what) => problem(file, what));
}

/**
 * Applies `patch` to the settings in `file` and returns them. An invalid
 * change throws and leaves the file as it was.
 */
export function updateSettings(file: string, patch: SettingsPatch): Settings {
  return write(file, (saved) => {
    const next: Record<string, unknown> = { ...saved };
    if (patch.theme !== undefined) next.theme = patch.theme;
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
    settings = JSON.parse(text);
  } catch (error) {
    throw problem(file, `isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(settings)) throw problem(file, "isn't a JSON object");
  return settings;
}

/** The settings `saved` holds, or the error `fail` makes of what's wrong with them. */
function check(saved: Record<string, unknown>, fail: (what: string) => Error): Settings {
  const {
    piPath,
    projectTrust = {},
    theme = DEFAULT_SETTINGS.theme,
    pool = {},
    shortcuts = {},
  } = saved;
  if (piPath !== undefined && (typeof piPath !== "string" || !path.isAbsolute(piPath))) {
    throw fail(`has a piPath that isn't an absolute path: ${JSON.stringify(piPath)}`);
  }
  if (
    !isObject(projectTrust) ||
    Object.values(projectTrust).some((answer) => typeof answer !== "boolean")
  ) {
    throw fail("has a projectTrust that isn't an object of true and false answers");
  }
  if (!isThemeSetting(theme)) {
    throw fail(`has a theme that isn't system, light or dark: ${JSON.stringify(theme)}`);
  }
  if (!isObject(pool)) throw fail("has a pool that isn't an object");
  const {
    maxLive = DEFAULT_SETTINGS.pool.maxLive,
    idleMinutes = DEFAULT_SETTINGS.pool.idleMinutes,
  } = pool;
  for (const [key, value] of [
    ["maxLive", maxLive],
    ["idleMinutes", idleMinutes],
  ] as const) {
    const { min, max } = POOL_RANGES[key];
    if (!isPoolValue(key, value)) {
      throw fail(
        `has a pool.${key} that isn't a whole number from ${min} to ${max}: ${JSON.stringify(value)}`,
      );
    }
  }
  if (!isObject(shortcuts)) throw fail("has shortcuts that aren't an object");
  for (const [command, text] of Object.entries(shortcuts)) {
    if (!isShortcutCommand(command)) {
      throw fail(`has a shortcut for ${JSON.stringify(command)}, which isn't a command`);
    }
    if (text !== null && (typeof text !== "string" || parseChord(text) === null)) {
      throw fail(`has a ${command} shortcut that isn't one: ${JSON.stringify(text)}`);
    }
  }
  return {
    piPath: piPath ?? null,
    theme,
    pool: { maxLive: maxLive as number, idleMinutes: idleMinutes as number },
    shortcuts: shortcuts as Settings["shortcuts"],
    projectTrust: projectTrust as Record<string, boolean>,
  };
}

function problem(file: string, what: string): Error {
  return new Error(`Tondo's settings file ${file} ${what}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
