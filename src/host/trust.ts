// Works out whether pi needs Tondo to settle project trust. pi 0.87.1 decides
// in resolveProjectTrusted (dist/core/project-trust.js), using
// dist/core/trust-manager.js. Tondo runs your pi rather than the one it's
// built with, so it can't import them, and pi.contract.test.ts checks that
// the two still agree.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** What pi loads from a project's `.pi` folder only if it trusts the project. */
const PROTECTED = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];

/**
 * The arguments that settle project trust for pi in `cwd`: none if pi settles
 * it by itself, else your answer in `answers`, keyed by the folder's realpath.
 * With no answer pi skips the project's protected files, since it can't ask
 * in RPC mode.
 */
export function trustArgs(
  cwd: string,
  env: Record<string, string>,
  answers: Record<string, boolean>,
): string[] {
  if (!needsTrustDecision(cwd, env)) return [];
  const answer = answers[canonical(cwd)];
  if (answer === undefined) return [];
  return [answer ? "--approve" : "--no-approve"];
}

/**
 * Whether pi, started in `cwd` with `env`, needs someone to decide whether to
 * trust the project: it has protected files, pi's trust.json holds no decision
 * for it or a parent folder, and pi's defaultProjectTrust is "ask". Tondo
 * can't see extensions that answer pi's project_trust event, and an answer
 * passed as a flag overrides them.
 */
export function needsTrustDecision(cwd: string, env: Record<string, string>): boolean {
  const home = env.HOME || os.homedir();
  const agentDir = piAgentDir(cwd, env, home);
  return (
    hasProtectedFiles(cwd, home) &&
    savedDecision(agentDir, cwd) === undefined &&
    defaultTrust(agentDir) === "ask"
  );
}

/** Mirrors hasTrustRequiringProjectResources: protected files, or `.agents/skills` above that isn't your home's. */
function hasProtectedFiles(cwd: string, home: string): boolean {
  let dir = canonical(cwd);
  if (PROTECTED.some((name) => existsSync(path.join(dir, ".pi", name)))) return true;
  const yourSkills = path.join(canonical(home), ".agents", "skills");
  for (;;) {
    const skills = path.join(dir, ".agents", "skills");
    if (skills !== yourSkills && existsSync(skills)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** The decision pi's trust.json holds for `cwd` or the nearest parent folder with one. */
function savedDecision(agentDir: string, cwd: string): boolean | undefined {
  const file = path.join(agentDir, "trust.json");
  if (!existsSync(file)) return undefined;
  let decisions: unknown;
  try {
    decisions = readJson(file);
  } catch (error) {
    throw new Error(`Can't read pi's trust store ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (typeof decisions !== "object" || decisions === null || Array.isArray(decisions)) {
    throw new Error(`pi's trust store ${file} isn't a JSON object`);
  }
  const byFolder = decisions as Record<string, unknown>;
  for (const [folder, decision] of Object.entries(byFolder)) {
    if (decision !== true && decision !== false && decision !== null) {
      throw new Error(
        `pi's trust store ${file} holds ${JSON.stringify(decision)} for ${folder}, not true, false or null`,
      );
    }
  }
  for (let dir = canonical(cwd); ; dir = path.dirname(dir)) {
    const decision = byFolder[dir];
    if (typeof decision === "boolean") return decision;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** pi's defaultProjectTrust setting. pi reads a missing or broken settings file as empty. */
function defaultTrust(agentDir: string): string {
  let settings: unknown;
  try {
    settings = readJson(path.join(agentDir, "settings.json"));
  } catch {
    return "ask";
  }
  const value = (settings as { defaultProjectTrust?: unknown } | null)?.defaultProjectTrust;
  return value === "always" || value === "never" ? value : "ask";
}

/** Mirrors pi's getAgentDir: PI_CODING_AGENT_DIR with `~` expanded, else `~/.pi/agent`. */
function piAgentDir(cwd: string, env: Record<string, string>, home: string): string {
  const dir = env.PI_CODING_AGENT_DIR;
  if (!dir) return path.join(home, ".pi", "agent");
  const expanded = dir === "~" ? home : dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
  return path.resolve(cwd, expanded);
}

/** Mirrors pi's canonicalizePath: the realpath, or the path itself if it doesn't exist. */
function canonical(file: string): string {
  const resolved = path.resolve(file);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Parses a JSON file, skipping a byte order mark as pi does. */
function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8");
  return JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
}
