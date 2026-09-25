// Launches the built app and scans its log for startup failures.
// Modeled on T3 Code's apps/desktop/scripts/smoke-test.mjs.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

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
];
// Bounds a failed run. A healthy one passes as soon as the ready line appears.
const DEADLINE_MS = 30_000;
const KILL_GRACE_MS = 5_000;

type Outcome = { ok: true; readyMs: number } | { ok: false; reason: string };

const repoRoot = path.resolve(import.meta.dirname, "..");
// Outside Electron, the electron package exports the path to its binary.
const electronPath = createRequire(import.meta.url)("electron") as string;
const profileDir = mkdtempSync(path.join(tmpdir(), "tondo-smoke-"));

const env: NodeJS.ProcessEnv = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: "1",
  TONDO_USER_DATA_DIR: profileDir,
};
delete env.ELECTRON_RENDERER_URL;
delete env.ELECTRON_RUN_AS_NODE;

const startedAt = performance.now();
const child = spawn(electronPath, ["."], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

let log = "";
const findFatal = () => FATAL_PATTERNS.find((pattern) => log.includes(pattern));

const outcome = await new Promise<Outcome>((resolve) => {
  const deadline = setTimeout(() => {
    resolve({ ok: false, reason: `no "${READY_LINE}" line within ${DEADLINE_MS / 1000} s` });
  }, DEADLINE_MS);
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

if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
  child.kill();
  const forceKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
  await exited;
  clearTimeout(forceKill);
}
rmSync(profileDir, { recursive: true, force: true });

// Anything Electron flushed while shutting down still counts.
const lateFatal = outcome.ok ? findFatal() : undefined;
if (!outcome.ok || lateFatal) {
  const reason = outcome.ok ? `the log contains "${lateFatal}"` : outcome.reason;
  console.error(`Smoke test failed: ${reason}.\n\nElectron's log:\n${log}`);
  process.exitCode = 1;
} else {
  console.log(`Smoke test passed. The renderer was ready ${outcome.readyMs} ms after launch.`);
}
