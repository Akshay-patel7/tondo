import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { READY_MARK } from "../src/shared/ready";

const repoRoot = path.resolve(__dirname, "..");
// A dev server URL would make the app skip the build under test, and
// ELECTRON_RUN_AS_NODE would start Electron as plain Node.
const UNSET_VARIABLES = new Set(["ELECTRON_RENDERER_URL", "ELECTRON_RUN_AS_NODE"]);

export interface Tondo {
  app: ElectronApplication;
  page: Page;
  /** `Date.now()` just before Electron started. */
  launchedAt: number;
  /** The app data folder, which holds settings.json and the logs. */
  profileDir: string;
  /** Quits the app and deletes its profile. Calling it again does nothing. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Gives every JavaScript heap in the app V8's `gc()`, so a test can collect garbage. */
  exposeGc?: boolean;
  /** Extra environment variables for the app, such as TONDO_TRANSCRIPT_MESSAGES. */
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
}: LaunchOptions = {}): Promise<Tondo> {
  const profileDir = await mkdtemp(path.join(tmpdir(), "tondo-e2e-"));
  if (settings) await writeFile(path.join(profileDir, "settings.json"), JSON.stringify(settings));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !UNSET_VARIABLES.has(name)) env[name] = value;
  }
  Object.assign(env, extraEnv);
  env.TONDO_USER_DATA_DIR = profileDir;

  const launchedAt = Date.now();
  const args = exposeGc ? ["--js-flags=--expose-gc", "."] : ["."];
  const app = await electron.launch({ args, cwd: repoRoot, env });
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
        await rm(profileDir, { recursive: true, force: true });
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
