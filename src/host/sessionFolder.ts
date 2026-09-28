// Works out where pi keeps a project's session files. pi 0.87.1 picks the
// folder in main.js: --session-dir, then PI_CODING_AGENT_SESSION_DIR, then
// the sessionDir setting, then a folder named after the project in its agent
// folder (getDefaultSessionDirPath in core/session-manager.js). The project's
// .pi/settings.json overrides yours, and pi reads it even before it trusts
// the project. pi.contract.test.ts checks that the two agree.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { piAgentDir, readJson } from "./trust";

export interface SessionFolder {
  readonly dir: string;
  /**
   * Whether the folder can hold other projects' sessions too. pi then counts
   * only the files whose header names the project.
   */
  readonly shared: boolean;
}

/** Where pi, started in `cwd` with `piArgs` and `env`, keeps the sessions it lists for `cwd`. */
export function sessionFolder(
  cwd: string,
  piArgs: readonly string[],
  env: Record<string, string>,
): SessionFolder {
  const home = env.HOME || os.homedir();
  const agentDir = piAgentDir(cwd, env, home);
  const own = path.join(agentDir, "sessions", folderName(path.resolve(cwd)));
  const chosen =
    lastSessionDirFlag(piArgs) ||
    env.PI_CODING_AGENT_SESSION_DIR ||
    sessionDirSetting(cwd, agentDir);
  if (!chosen) return { dir: own, shared: false };
  const expanded = expand(chosen, home);
  return { dir: path.resolve(cwd, expanded), shared: expanded !== own };
}

/** The name pi gives a project's own session folder: `--` + its path with separators and colons as dashes + `--`. */
function folderName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Mirrors pi's parseArgs: `--session-dir <dir>`, the last one winning. */
function lastSessionDirFlag(args: readonly string[]): string | undefined {
  let dir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session-dir" && i + 1 < args.length) dir = args[++i];
  }
  return dir;
}

/**
 * The sessionDir setting. pi deep-merges your settings with the project's, so
 * the project's wins when it has the key at all, and it reads a missing or
 * broken file as empty.
 */
function sessionDirSetting(cwd: string, agentDir: string): string | undefined {
  const yours = readSettings(path.join(agentDir, "settings.json"));
  const project = readSettings(path.join(path.resolve(cwd), ".pi", "settings.json"));
  const value = Object.hasOwn(project, "sessionDir") ? project.sessionDir : yours.sessionDir;
  // pi can't start with a sessionDir that isn't a string, and says why.
  return typeof value === "string" ? value : undefined;
}

function readSettings(file: string): Record<string, unknown> {
  try {
    const settings = readJson(file);
    return typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Mirrors pi's normalizePath: expands `~` and file URLs, and leaves the rest alone. */
function expand(dir: string, home: string): string {
  if (dir === "~") return home;
  if (dir.startsWith("~/")) return path.join(home, dir.slice(2));
  if (dir.startsWith("file://")) return fileURLToPath(dir);
  return dir;
}
