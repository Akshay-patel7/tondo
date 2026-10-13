// Finds the pi to run and the node to run it with. Tondo runs
// `<node> <cli.js>` rather than `pi`, since a version manager's shim or pi's
// `#!/usr/bin/env node` line would pick the Node a folder pins, which may be
// too old for pi or have no pi at all.
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { PiProblem } from "../shared/protocol";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
export const MIN_PI_VERSION = "0.87.1";

export interface PiInstall {
  /** The pi command it was found as: on PATH, in the settings, or an install an asdf shim names. */
  command: string;
  /** The node in the same folder as the `pi` command. */
  node: string;
  /** The realpath of pi's cli.js. */
  cli: string;
  packageDir: string;
  version: string;
}

export class PiNotFoundError extends Error {
  override name = "PiNotFoundError";
  readonly problem: PiProblem;

  constructor(message: string, problem: PiProblem) {
    super(message);
    this.problem = problem;
  }
}

/** Which problem to report when no install works: the one you can most easily fix. */
const PROBLEM_ORDER: readonly PiProblem["kind"][] = ["too-old", "invalid", "not-found"];

/**
 * Finds pi at `override` if it's set, else at the first `pi` on the PATH in
 * `env`. An asdf shim stands for the installs it names, and the newest pi
 * among them wins.
 */
export function findPi(env: Record<string, string>, override?: string | null): PiInstall {
  const command = override ?? onPath("pi", env.PATH ?? "");
  if (command === undefined) {
    const message = `No pi on PATH: ${env.PATH ?? ""}`;
    throw new PiNotFoundError(message, { kind: "not-found", detail: message });
  }
  const commands = asdfShimTargets(command) ?? [command];
  const installs: PiInstall[] = [];
  const problems: PiNotFoundError[] = [];
  for (const candidate of commands) {
    try {
      installs.push(installAt(candidate));
    } catch (error) {
      const message = (error as Error).message;
      problems.push(
        error instanceof PiNotFoundError
          ? error
          : new PiNotFoundError(message, { kind: "invalid", detail: message }),
      );
    }
  }
  const newest = installs.toSorted((a, b) => compareVersions(b.version, a.version))[0];
  if (newest !== undefined) return newest;
  const [first] = problems.toSorted(
    (a, b) => PROBLEM_ORDER.indexOf(a.problem.kind) - PROBLEM_ORDER.indexOf(b.problem.kind),
  );
  throw new PiNotFoundError(problems.map(({ message }) => message).join("\n"), first!.problem);
}

/** The pi that `command` runs, if it's 0.87.1 or newer and has a node next to it. */
function installAt(command: string): PiInstall {
  let real: string;
  try {
    real = realpathSync(command);
  } catch {
    const message = `${command} doesn't exist`;
    throw new PiNotFoundError(message, { kind: "not-found", detail: message });
  }
  const found = packageOf(real);
  if (found === undefined) throw invalid(`${command} isn't part of ${PI_PACKAGE}`);
  const { dir, version, bin } = found;
  if (compareVersions(version, MIN_PI_VERSION) < 0) {
    throw new PiNotFoundError(
      `${command} is pi ${version}, and Tondo needs ${MIN_PI_VERSION} or newer`,
      { kind: "too-old", version, required: MIN_PI_VERSION, command },
    );
  }
  if (bin === undefined) throw invalid(`${path.join(dir, "package.json")} names no pi command`);
  const node = path.join(path.dirname(command), "node");
  if (!isExecutableFile(node)) throw invalid(`${command} has no node next to it at ${node}`);
  return { command, node, cli: realpathSync(path.join(dir, bin)), packageDir: dir, version };
}

function invalid(message: string): PiNotFoundError {
  return new PiNotFoundError(message, { kind: "invalid", detail: message });
}

interface PiPackage {
  dir: string;
  version: string;
  bin: string | undefined;
}

/** pi's package folder at or above `file`, with what its package.json says. */
function packageOf(file: string): PiPackage | undefined {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = readJson(path.join(dir, "package.json"));
    if (manifest?.name === PI_PACKAGE) {
      const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
      return { dir, version: String(manifest.version), bin };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

interface Manifest {
  name?: unknown;
  version?: unknown;
  bin?: string | { pi?: string };
}

function readJson(file: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

/**
 * The commands an asdf shim stands for, or undefined if `command` isn't one.
 * A shim names each install with a `# asdf-plugin: <plugin> <version>` line,
 * and lives in `<asdf data dir>/shims`.
 */
function asdfShimTargets(command: string): string[] | undefined {
  const lines = [...readHead(command).matchAll(/^# asdf-plugin: (\S+) (\S+)$/gm)];
  if (lines.length === 0) return undefined;
  const dataDir = path.dirname(path.dirname(command));
  const name = path.basename(command);
  return lines.map(([, plugin, version]) =>
    path.join(dataDir, "installs", plugin!, version!, "bin", name),
  );
}

/** The first 4 KB of `file`, or "" if it can't be read. Shims are small, and pi may be a binary. */
function readHead(file: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(4096);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, buffer.length, 0));
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The first executable file called `name` in PATH's absolute entries. */
function onPath(name: string, pathValue: string): string | undefined {
  return pathValue
    .split(":")
    .filter((dir) => path.isAbsolute(dir))
    .map((dir) => path.join(dir, name))
    .find(isExecutableFile);
}

function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Compares `major.minor.patch` versions. Anything else counts as 0.0.0. */
function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(
    (version) => /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number) ?? [0, 0, 0],
  );
  return x![0]! - y![0]! || x![1]! - y![1]! || x![2]! - y![2]!;
}
