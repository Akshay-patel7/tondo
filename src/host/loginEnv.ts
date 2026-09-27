// Reads the environment your login shell sets up, so pi sees the PATH and API
// keys it sees in a terminal. The choice of shell, the 5 s deadline, and the
// macOS launchctl and locale fallbacks are adapted from T3 Code,
// apps/desktop/src/shell/DesktopShellEnvironment.ts and
// packages/shared/src/shell.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import { drainGroup } from "./processGroup";

const START = "__TONDO_ENV_START__";
const END = "__TONDO_ENV_END__";
/** What the login shell runs: its whole environment, NUL-separated, between markers. */
const CAPTURE = `printf '%s' ${START}; env -0; printf '%s' ${END}`;
/** How long a shell that misses the deadline gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 1_000;
/** How much of the shell's stderr a failure keeps. */
const STDERR_TAIL = 2_000;
/** Variables that describe the capture run rather than your setup. */
const SHELL_STATE = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
const LOCALE = ["LANG", "LC_ALL", "LC_CTYPE"];

export interface LoginEnv {
  env: Record<string, string>;
  /** Why the login shell's environment couldn't be used, if it couldn't. */
  problem?: string;
}

/**
 * Runs your login shell once and returns the environment it sets up, minus
 * the variables that belong to Electron or to the capture run. If the shell
 * fails or misses the deadline, returns `inherited` instead, with launchd's
 * PATH in front on macOS.
 */
export async function captureLoginEnv(
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  deadlineMs = 5_000,
): Promise<LoginEnv> {
  const shell = loginShell(inherited, platform);
  try {
    return { env: clean(await runLoginShell(shell, inherited, deadlineMs), platform) };
  } catch (error) {
    const env = Object.fromEntries(
      Object.entries(inherited).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    if (platform === "darwin") {
      const path = mergePaths(await readLaunchctlPath(), inherited.PATH);
      if (path) env.PATH = path;
    }
    return { env: clean(env, platform), problem: `${shell} -ilc: ${(error as Error).message}` };
  }
}

/** `$SHELL`, else your account's shell, else the platform's default. */
function loginShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return env.SHELL?.trim() || accountShell() || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

function accountShell(): string | undefined {
  try {
    return os.userInfo().shell?.trim() || undefined;
  } catch {
    // A user with no passwd entry, as in some containers.
    return undefined;
  }
}

/**
 * Resolves with the environment the shell printed before it exited or before
 * the deadline, whichever came first. It must include PATH.
 */
function runLoginShell(
  shell: string,
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    // In a group of its own, so the deadline also stops what the startup files started.
    const child = spawn(shell, ["-ilc", CAPTURE], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    const printed = () => {
      const captured = parseCapture(Buffer.concat(stdout).toString("utf8"));
      return captured?.PATH === undefined ? undefined : captured;
    };
    const failure = (outcome: string) =>
      new Error(stderr.trim() ? `${outcome}. Its stderr ends with:\n${stderr.trim()}` : outcome);

    const timer = setTimeout(() => {
      timedOut = true;
      // Output that arrives while the group is being stopped doesn't count.
      const captured = printed();
      drainGroup(child.pid!, KILL_GRACE_MS).then(
        () =>
          captured
            ? resolve(captured)
            : reject(failure(`printed no environment within ${deadlineMs} ms`)),
        reject,
      );
    }, deadlineMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return;
      const captured = printed();
      if (captured) resolve(captured);
      else reject(failure(`exited with ${signal ?? `code ${code}`} and printed no environment`));
    });
  });
}

/** The variables `env -0` printed between the markers, or undefined without both markers. */
function parseCapture(output: string): Record<string, string> | undefined {
  const start = output.indexOf(START);
  if (start === -1) return undefined;
  const end = output.indexOf(END, start + START.length);
  if (end === -1) return undefined;
  const env: Record<string, string> = {};
  for (const entry of output.slice(start + START.length, end).split("\0")) {
    const equals = entry.indexOf("=");
    if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return env;
}

/** Drops Electron's variables and the capture run's own, and undoes Electron's changes. */
function clean(env: Record<string, string>, platform: NodeJS.Platform): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !name.startsWith("ELECTRON_") &&
        !SHELL_STATE.has(name) &&
        name !== "ORIGINAL_XDG_CURRENT_DESKTOP",
    ),
  );
  // On Linux, Electron may change XDG_CURRENT_DESKTOP and keep the value it
  // started with in ORIGINAL_XDG_CURRENT_DESKTOP (electron#47414).
  const original = env.ORIGINAL_XDG_CURRENT_DESKTOP;
  if (original !== undefined) result.XDG_CURRENT_DESKTOP = original;
  // From T3: apps opened from the Dock get no locale, so tools run in the C
  // locale and pbcopy reads their UTF-8 output as MacRoman. Older macOS
  // releases have no C.UTF-8, and setting only LC_CTYPE leaves sorting and
  // number formats alone.
  if (platform === "darwin" && LOCALE.every((name) => !result[name]?.trim())) {
    result.LC_CTYPE = "en_US.UTF-8";
  }
  return result;
}

/** The entries of each PATH in turn, without repeats or empty entries. */
function mergePaths(...paths: (string | undefined)[]): string {
  return [...new Set(paths.flatMap((path) => path?.split(":") ?? []).filter(Boolean))].join(":");
}

/** The PATH launchd gives apps, which `launchctl setenv` can change. */
function readLaunchctlPath(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "/bin/launchctl",
      ["getenv", "PATH"],
      { encoding: "utf8", timeout: 2_000 },
      (error, stdout) => {
        resolve(error ? undefined : stdout.trim() || undefined);
      },
    );
  });
}
