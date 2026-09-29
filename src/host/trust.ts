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

/** Who settles whether pi, started in a project, trusts it. */
export type PiTrust =
  /** The project has no protected files, so there's nothing to trust. */
  | { readonly decidedBy: "nothing" }
  /** pi's trust.json holds a decision for `folder`, the project or a folder above it. */
  | { readonly decidedBy: "trust-file"; readonly trusted: boolean; readonly folder: string }
  /** pi's defaultProjectTrust setting is "always" or "never". */
  | { readonly decidedBy: "default"; readonly trusted: boolean }
  /** pi would ask, and can't in RPC mode, so someone has to answer for it. */
  | { readonly decidedBy: "ask" };

/**
 * Who settles project trust for pi started in `cwd` with `env`: nobody if
 * the project has no protected files, else pi's trust.json for the project or
 * a parent folder, else pi's defaultProjectTrust unless it's "ask". Tondo
 * can't see extensions that answer pi's project_trust event, and an answer
 * passed as a flag overrides them.
 */
export function piTrust(cwd: string, env: Record<string, string>): PiTrust {
  const home = env.HOME || os.homedir();
  const agentDir = piAgentDir(cwd, env, home);
  if (!hasProtectedFiles(cwd, home)) return { decidedBy: "nothing" };
  const saved = savedDecision(agentDir, cwd);
  if (saved) return { decidedBy: "trust-file", ...saved };
  const fallback = defaultTrust(agentDir);
  if (fallback !== "ask") return { decidedBy: "default", trusted: fallback === "always" };
  return { decidedBy: "ask" };
}

/** Whether pi, started in `cwd` with `env`, needs someone to decide whether to trust the project. */
export function needsTrustDecision(cwd: string, env: Record<string, string>): boolean {
  return piTrust(cwd, env).decidedBy === "ask";
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

/** The decision pi's trust.json holds for `cwd` or the nearest parent folder with one, and that folder. */
function savedDecision(
  agentDir: string,
  cwd: string,
): { trusted: boolean; folder: string } | undefined {
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
    if (typeof decision === "boolean") return { trusted: decision, folder: dir };
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
export function piAgentDir(cwd: string, env: Record<string, string>, home: string): string {
  const dir = env.PI_CODING_AGENT_DIR;
  if (!dir) return path.join(home, ".pi", "agent");
  const expanded = dir === "~" ? home : dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
  return path.resolve(cwd, expanded);
}

/**
 * Mirrors pi's canonicalizePath: the realpath, or the path itself if it
 * doesn't exist. Tondo keeps your trust answers under it too.
 */
export function canonical(file: string): string {
  const resolved = path.resolve(file);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Parses a JSON file, skipping a byte order mark as pi does. */
export function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8");
  return JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
}
