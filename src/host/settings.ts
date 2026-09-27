// Tondo's own settings, in settings.json in the app data folder. The host is
// the only process that reads it.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Settings {
  /** The pi command to run instead of the one on PATH. Stage 12 adds a UI for it. */
  piPath?: string;
  /** Your answers to whether to trust a project, by the project folder's realpath. */
  projectTrust: Record<string, boolean>;
}

/** Reads the settings in `file`. A missing file holds the defaults. */
export function readSettings(file: string): Settings {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projectTrust: {} };
    throw error;
  }
  const problem = (what: string) => new Error(`Tondo's settings file ${file} ${what}`);
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    throw problem(`isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(settings)) throw problem("isn't a JSON object");
  const { piPath, projectTrust = {} } = settings;
  if (piPath !== undefined && (typeof piPath !== "string" || !path.isAbsolute(piPath))) {
    throw problem(`has a piPath that isn't an absolute path: ${JSON.stringify(piPath)}`);
  }
  if (
    !isObject(projectTrust) ||
    Object.values(projectTrust).some((answer) => typeof answer !== "boolean")
  ) {
    throw problem("has a projectTrust that isn't an object of true and false answers");
  }
  return {
    ...(piPath === undefined ? {} : { piPath }),
    projectTrust: projectTrust as Record<string, boolean>,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
