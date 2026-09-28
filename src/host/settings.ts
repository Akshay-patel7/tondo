// Tondo's own settings, in settings.json in the app data folder. The host is
// the only process that reads or writes it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonical } from "./trust";

export interface Settings {
  /** The pi command to run instead of the one on PATH. Stage 12 adds a UI for it. */
  piPath?: string;
  /** Your answers to whether to trust a project, by the project folder's realpath. */
  projectTrust: Record<string, boolean>;
}

/** Reads the settings in `file`. A missing file holds the defaults. */
export function readSettings(file: string): Settings {
  return check(file, readObject(file));
}

/**
 * Remembers your answer to whether to trust `project`. It keeps everything
 * else in the file, keys this version doesn't know included, and replaces the
 * file in one step so a crash can't leave half of it.
 */
export function saveTrustAnswer(file: string, project: string, trusted: boolean): void {
  const saved = readObject(file);
  const { projectTrust } = check(file, saved);
  const settings = { ...saved, projectTrust: { ...projectTrust, [canonical(project)]: trusted } };
  mkdirSync(path.dirname(file), { recursive: true });
  const unfinished = `${file}.${process.pid}.tmp`;
  writeFileSync(unfinished, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(unfinished, file);
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

/** The settings `saved` holds, or an error naming what's wrong with them. */
function check(file: string, saved: Record<string, unknown>): Settings {
  const { piPath, projectTrust = {} } = saved;
  if (piPath !== undefined && (typeof piPath !== "string" || !path.isAbsolute(piPath))) {
    throw problem(file, `has a piPath that isn't an absolute path: ${JSON.stringify(piPath)}`);
  }
  if (
    !isObject(projectTrust) ||
    Object.values(projectTrust).some((answer) => typeof answer !== "boolean")
  ) {
    throw problem(file, "has a projectTrust that isn't an object of true and false answers");
  }
  return {
    ...(piPath === undefined ? {} : { piPath }),
    projectTrust: projectTrust as Record<string, boolean>,
  };
}

function problem(file: string, what: string): Error {
  return new Error(`Tondo's settings file ${file} ${what}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
