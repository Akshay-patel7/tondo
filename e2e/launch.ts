import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { READY_MARK } from "../src/shared/ready";

const repoRoot = path.resolve(__dirname, "..");
// A dev server URL would make the app skip the build under test, and
// ELECTRON_RUN_AS_NODE would start Electron as plain Node.
const UNSET_VARIABLES = new Set(["ELECTRON_RENDERER_URL", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]);

/**
 * A packaged executable to test instead of `electron .`, such as
 * dist/e2e/mac-arm64/Tondo.app/Contents/MacOS/Tondo. A packaged app would
 * otherwise find your real pi, so it runs with a scratch HOME and agent folder.
 */
const PACKAGED_EXECUTABLE = process.env.TONDO_E2E_EXECUTABLE || undefined;

/** Where `settings.json` points pi when a packaged test sets no `piPath`: a file that doesn't exist. */
function missingPi(scratch: string): string {
  return path.join(scratch, "no-pi", "pi");
}

export interface Tondo {
  app: ElectronApplication;
  page: Page;
  /** `Date.now()` just before Electron started. */
  launchedAt: number;
  /** The app data folder, which holds settings.json and the logs. */
  profileDir: string;
  /** Quits the app and deletes a profile it created. Caller-owned profiles stay. Calling it again does nothing. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** A caller-owned profile, kept across close() for restart tests. Otherwise each launch gets a temporary one. */
  profileDir?: string;
  /** Gives every JavaScript heap in the app V8's `gc()`, so a test can collect garbage. */
  exposeGc?: boolean;
  /** Extra environment variables for the app, such as TONDO_PI_ARGS. */
  env?: Record<string, string>;
  /** Written to the profile's settings.json before the app starts. */
  settings?: Record<string, unknown>;
}

/**
 * Launches the built app (`electron-vite build` first) with a throwaway
 * profile, and waits until the renderer has painted its first frame.
 */
export async function launchTondo({
  exposeGc = false,
  env: extraEnv = {},
  settings,
  profileDir: savedProfile,
}: LaunchOptions = {}): Promise<Tondo> {
  const profileDir = savedProfile ?? (await mkdtemp(path.join(tmpdir(), "tondo-e2e-")));
  const scratch = PACKAGED_EXECUTABLE ? await mkdtemp(path.join(tmpdir(), "tondo-e2e-run-")) : "";
  const settingsFile = path.join(profileDir, "settings.json");
  if (PACKAGED_EXECUTABLE && (settings || !existsSync(settingsFile))) {
    await writeFile(settingsFile, JSON.stringify({ piPath: missingPi(scratch), ...settings }));
  } else if (settings) {
    await writeFile(settingsFile, JSON.stringify(settings));
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !UNSET_VARIABLES.has(name)) env[name] = value;
  }
  if (PACKAGED_EXECUTABLE) {
    await mkdir(path.join(scratch, "home"));
    Object.assign(env, {
      HOME: path.join(scratch, "home"),
      PI_CODING_AGENT_DIR: path.join(scratch, "pi-agent"),
      CONTEXT_MODE_DATA_DIR: path.join(scratch, "context-mode"),
      TONDO_DISABLE_UPDATES: "1",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      ELECTRON_ENABLE_LOGGING: "1",
    });
  }
  Object.assign(env, extraEnv);
  env.TONDO_USER_DATA_DIR = profileDir;

  const launchedAt = Date.now();
  const flags = exposeGc ? ["--js-flags=--expose-gc"] : [];
  // Without this, the cookie-encryption fuse adds "Tondo Safe Storage" to your login keychain.
  const packagedFlags = process.platform === "darwin" ? ["--use-mock-keychain"] : [];
  const app = PACKAGED_EXECUTABLE
    ? await electron.launch({
        executablePath: PACKAGED_EXECUTABLE,
        args: [...packagedFlags, ...flags],
        env,
      })
    : await electron.launch({ args: [...flags, "."], cwd: repoRoot, env });
  const page = await app.firstWindow();
  await page.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, READY_MARK);

  let closing: Promise<void> | undefined;
  return {
    app,
    page,
    launchedAt,
    profileDir,
    close() {
      closing ??= (async () => {
        await app.close();
        if (scratch) await rm(scratch, { recursive: true, force: true });
        if (savedProfile === undefined) await rm(profileDir, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}

/**
 * Keeps the window on top and focused. Electron throttles timers and
 * animation frames in windows you can't see, so any test that counts on
 * frames needs this.
 */
export async function bringToFront({ app, page }: Tondo): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Tondo has no window to bring to the front");
    window.setAlwaysOnTop(true);
    electronApp.focus({ steal: true });
    window.focus();
  });
  await page.waitForFunction(() => document.visibilityState === "visible" && document.hasFocus());
}

/** The pid of the host utility process, which main names "Tondo Host". */
export function hostPid(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ app: electronApp }) => {
    const hosts = electronApp.getAppMetrics().filter((metric) => metric.name === "Tondo Host");
    if (hosts.length !== 1) throw new Error(`Expected one Tondo Host, found ${hosts.length}`);
    return hosts[0]!.pid;
  });
}

/**
 * Replaces `shell.openExternal` in the main process so a test can see which
 * URL the app tried to open, without opening a browser. The returned function
 * resolves with the first URL passed to it.
 */
export async function captureOpenExternal(
  app: ElectronApplication,
): Promise<() => Promise<string>> {
  await app.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { tondoOpenedUrl?: Promise<string> };
    state.tondoOpenedUrl = new Promise((resolve) => {
      shell.openExternal = async (url) => resolve(url);
    });
  });
  return () =>
    app.evaluate(() => {
      const state = globalThis as typeof globalThis & { tondoOpenedUrl?: Promise<string> };
      if (!state.tondoOpenedUrl) throw new Error("captureOpenExternal wasn't set up");
      return state.tondoOpenedUrl;
    });
}
