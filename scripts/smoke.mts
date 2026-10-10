// Launches the built app, or a packaged one with --app, and scans its log for startup failures.
// Modeled on T3 Code's apps/desktop/scripts/smoke-test.mjs.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
//
// Usage:
//   node scripts/smoke.mts                              launches `electron .`
//   node scripts/smoke.mts --app <path> [--allow-no-sandbox]
//     <path> is the app's executable (.../Tondo.app/Contents/MacOS/Tondo, /opt/Tondo/tondo,
//     an .AppImage) or a .app bundle. A packaged app runs the user's real pi through their login
//     shell, so --app always launches with a scratch HOME and a pi path that doesn't exist.
//     --extra-arg <arg> (repeatable, for the sandbox control) appends an argument to the launch.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

// The renderer logs READY_MARK from src/shared/ready.ts once the first frame has painted.
const READY_LINE = "tondo:ready";
const FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Unable to load preload script",
  "Refused to execute",
  "Refused to load",
  "Refused to apply",
  "Uncaught ",
  // src/main/host.ts and src/host/index.ts, when the host dies or can't start.
  "Tondo Host exited",
  "Tondo Host failed to start",
  // src/main/rendererRecovery.ts. The reload would hide the crash from the ready line.
  "Tondo's renderer died",
];
// Bounds a failed run. A healthy one passes as soon as the ready line appears.
// A packaged app gets longer: x64 under Rosetta took 22.7 s on its first launch, and CI runners are slower.
const DEADLINE_MS = 30_000;
const PACKAGED_DEADLINE_MS = 90_000;
const KILL_GRACE_MS = 5_000;
// Chromium passes this to every sandboxed process on macOS: the fd of the Seatbelt (sandbox_init)
// client. Found by comparing a normal launch of the packaged arm64 app with a --no-sandbox one
// (see .dev/stage13/mac/smoke-control-no-sandbox.log): only the sandboxed renderers carry it.
const MAC_SANDBOX_MARKER = "--seatbelt-client=";

type Outcome = { ok: true; readyMs: number } | { ok: false; reason: string };
type Proc = { pid: number; ppid: number; command: string };

const { values: options } = parseArgs({
  options: {
    app: { type: "string" },
    "allow-no-sandbox": { type: "boolean" },
    "extra-arg": { type: "string", multiple: true },
  },
});

const repoRoot = path.resolve(import.meta.dirname, "..");
const runDir = mkdtempSync(path.join(tmpdir(), "tondo-smoke-"));

function resolveExecutable(target: string): string {
  const bundle = path.resolve(target);
  if (!bundle.endsWith(".app")) return bundle;
  const macOsDir = path.join(bundle, "Contents", "MacOS");
  const names = readdirSync(macOsDir);
  return path.join(macOsDir, names.includes("Tondo") ? "Tondo" : (names[0] ?? ""));
}

function packagedEnv(): NodeJS.ProcessEnv {
  const profileDir = path.join(runDir, "profile");
  const homeDir = path.join(runDir, "home");
  mkdirSync(profileDir);
  mkdirSync(homeDir);
  // Discovery never runs a pi: this path doesn't exist.
  writeFileSync(
    path.join(profileDir, "settings.json"),
    JSON.stringify({ piPath: path.join(runDir, "no-pi", "pi") }),
  );
  const env: NodeJS.ProcessEnv = {
    HOME: homeDir,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    PI_CODING_AGENT_DIR: path.join(runDir, "pi-agent"),
    CONTEXT_MODE_DATA_DIR: path.join(runDir, "context-mode"),
    TONDO_USER_DATA_DIR: profileDir,
    TONDO_DISABLE_UPDATES: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  };
  if (process.platform === "linux") {
    for (const name of ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
  }
  return env;
}

function listProcesses(): Proc[] {
  if (process.platform === "linux") {
    const procs: Proc[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        // The command name in field 2 may contain spaces, so split after its closing parenthesis.
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        const command = readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
        procs.push({ pid: Number(entry), ppid, command });
      } catch {
        // The process exited while we were listing.
      }
    }
    return procs;
  }
  const output = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }]
      : [];
  });
}

function processTree(rootPid: number): Proc[] {
  const all = listProcesses();
  const tree = all.filter((proc) => proc.pid === rootPid);
  for (let i = 0; i < tree.length; i++) {
    for (const proc of all) {
      if (proc.ppid === tree[i]?.pid) tree.push(proc);
    }
  }
  return tree;
}

type SandboxCheck = { ok: boolean; reason: string; evidence: string[] };

function checkSandbox(tree: readonly Proc[]): SandboxCheck {
  const evidence = tree.map((proc) => `${proc.pid} ${proc.command.slice(0, 200)}`);
  if (process.platform === "darwin") {
    for (const proc of tree.filter((p) => p.command.includes("--type=renderer"))) {
      const has = proc.command.includes(MAC_SANDBOX_MARKER);
      evidence.push(`renderer ${proc.pid}: ${MAC_SANDBOX_MARKER} ${has ? "present" : "absent"}`);
    }
  }
  const unsandboxed = tree.find((proc) => proc.command.includes("--no-sandbox"));
  if (unsandboxed)
    return { ok: false, reason: `pid ${unsandboxed.pid} has --no-sandbox`, evidence };
  const renderers = tree.filter((proc) => proc.command.includes("--type=renderer"));
  if (renderers.length === 0) return { ok: false, reason: "no --type=renderer process", evidence };
  for (const renderer of renderers) {
    if (process.platform === "linux") {
      const status = readFileSync(`/proc/${renderer.pid}/status`, "utf8");
      const seccomp = /^Seccomp:\t(\d+)$/m.exec(status)?.[1];
      evidence.push(`renderer ${renderer.pid}: Seccomp ${seccomp}`);
      if (seccomp !== "2") {
        return { ok: false, reason: `renderer ${renderer.pid} has Seccomp ${seccomp}`, evidence };
      }
    } else {
      const sandboxed = renderer.command.includes(MAC_SANDBOX_MARKER);
      if (!sandboxed) {
        return {
          ok: false,
          reason: `renderer ${renderer.pid} lacks ${MAC_SANDBOX_MARKER}`,
          evidence,
        };
      }
    }
  }
  const how = process.platform === "linux" ? "Seccomp 2" : MAC_SANDBOX_MARKER.slice(0, -1);
  return { ok: true, reason: `${renderers.length} renderer(s) with ${how}`, evidence };
}

const packaged = options.app !== undefined;
let command: string;
let args: string[];
let env: NodeJS.ProcessEnv;
let cwd: string | undefined;
if (options.app !== undefined) {
  command = resolveExecutable(options.app);
  args = [
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
    ...(options["extra-arg"] ?? []),
  ];
  env = packagedEnv();
  if (command.endsWith(".AppImage") && !existsSync("/dev/fuse")) env.APPIMAGE_EXTRACT_AND_RUN = "1";
} else {
  // Outside Electron, the electron package exports the path to its binary.
  command = createRequire(import.meta.url)("electron") as string;
  args = ["."];
  cwd = repoRoot;
  env = { ...process.env, ELECTRON_ENABLE_LOGGING: "1", TONDO_USER_DATA_DIR: runDir };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
}

// An AppImage's runtime runs the app as its child and doesn't forward signals, so the app gets
// its own process group and the whole group is signalled.
const ownGroup = command.endsWith(".AppImage");
const startedAt = performance.now();
const child = spawn(command, args, {
  cwd,
  env,
  detached: ownGroup,
  stdio: ["ignore", "pipe", "pipe"],
});
const signalApp = (signal: NodeJS.Signals) => {
  if (ownGroup && child.pid !== undefined) process.kill(-child.pid, signal);
  else child.kill(signal);
};
const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

let log = "";
const findFatal = () => FATAL_PATTERNS.find((pattern) => log.includes(pattern));

const deadlineMs = packaged ? PACKAGED_DEADLINE_MS : DEADLINE_MS;
let outcome = await new Promise<Outcome>((resolve) => {
  const deadline = setTimeout(() => {
    resolve({ ok: false, reason: `no "${READY_LINE}" line within ${deadlineMs / 1000} s` });
  }, deadlineMs);
  const settle = (result: Outcome) => {
    clearTimeout(deadline);
    resolve(result);
  };
  const onOutput = (chunk: Buffer) => {
    log += chunk.toString();
    const fatal = findFatal();
    if (fatal) settle({ ok: false, reason: `the log contains "${fatal}"` });
    else if (log.includes(READY_LINE)) {
      settle({ ok: true, readyMs: Math.round(performance.now() - startedAt) });
    }
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  child.once("error", (error) =>
    settle({ ok: false, reason: `Electron didn't start: ${error.message}` }),
  );
  child.once("exit", (code, signal) => {
    settle({
      ok: false,
      reason: `Electron exited before it was ready (code ${code}, signal ${signal})`,
    });
  });
});

let sandboxSummary = "";
let tree: Proc[] = [];
if (packaged && outcome.ok && child.pid !== undefined) {
  tree = processTree(child.pid);
  const sandbox = checkSandbox(tree);
  console.log(`Process tree of pid ${child.pid}:\n${sandbox.evidence.join("\n")}`);
  sandboxSummary = sandbox.reason;
  if (!sandbox.ok) {
    if (options["allow-no-sandbox"]) {
      console.warn(
        `WARNING: the sandbox is not proven (${sandbox.reason}); --allow-no-sandbox is set.`,
      );
      sandboxSummary = `NOT PROVEN (${sandbox.reason}), allowed`;
    } else {
      outcome = { ok: false, reason: `the sandbox is not proven: ${sandbox.reason}` };
    }
  }
}

let leftover = "";
if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
  signalApp("SIGTERM");
  const forceKill = setTimeout(() => signalApp("SIGKILL"), KILL_GRACE_MS);
  await exited;
  clearTimeout(forceKill);
}
// Helpers exit on their own once the main process is gone; give them the same grace period.
const helperDeadline = Date.now() + KILL_GRACE_MS;
const helpers = tree.filter((proc) => proc.pid !== child.pid);
await new Promise<void>((resolve) => {
  const poll = setInterval(() => {
    if (helpers.some((proc) => isAlive(proc.pid)) && Date.now() < helperDeadline) return;
    clearInterval(poll);
    resolve();
  }, 50);
});
for (const proc of helpers.filter((p) => isAlive(p.pid))) {
  leftover += ` ${proc.pid}`;
  process.kill(proc.pid, "SIGKILL");
}
if (leftover) outcome = { ok: false, reason: `processes outlived the app:${leftover}` };
rmSync(runDir, { recursive: true, force: true });

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Anything Electron flushed while shutting down still counts.
const lateFatal = outcome.ok ? findFatal() : undefined;
if (!outcome.ok || lateFatal) {
  const reason = outcome.ok ? `the log contains "${lateFatal}"` : outcome.reason;
  console.error(`Smoke test failed: ${reason}.\n\nElectron's log:\n${log}`);
  process.exitCode = 1;
} else if (packaged) {
  console.log(
    `Smoke test passed (packaged): ready in ${outcome.readyMs} ms; sandbox: ${sandboxSummary}`,
  );
} else {
  console.log(`Smoke test passed. The renderer was ready ${outcome.readyMs} ms after launch.`);
}
