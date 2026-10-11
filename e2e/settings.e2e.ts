// The settings page with the real pi, offline with the faux model: the theme
// across a relaunch, pool limits applied live, rebinding a shortcut, choosing
// pi, and showing pi's settings files.
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chordLabel, parseChord } from "../src/shared/shortcuts";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  answerFolderDialog,
  launchWithPi,
  PI_CLI,
  PI_START_TIMEOUT_MS,
  reply,
  send,
  threads,
  waitForIdle,
  waitForPi,
} from "./pi";
import { piGroup, piGroups, processesIn } from "./processes";

test.describe.configure({ timeout: 60_000 });

const isMac = process.platform === "darwin";

/** The version of the pi that pnpm installed, which e2e runs. */
const PI_VERSION = (
  JSON.parse(readFileSync(path.join(path.dirname(PI_CLI), "../../package.json"), "utf8")) as {
    version: string;
  }
).version;

let workDir: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-settings-e2e-")));
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

test("the theme follows the setting, stays after a relaunch, and goes back to the system's", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({ workDir, script: { responses: [] }, profileDir });
  let { page } = tondo;
  // Playwright emulates a light color scheme unless told not to, which would
  // hide the one Electron takes from the theme Tondo sets.
  await page.emulateMedia({ colorScheme: null });
  let settings = await openSettings(page);
  let theme = settings.getByRole("group", { name: "Theme", exact: true });

  // Light first, so Dark has to change the scheme whatever the computer's is.
  await theme.getByRole("button", { name: "Light", exact: true }).click();
  await expect.poll(() => saved(profileDir).theme).toBe("light");
  await expect.poll(() => prefersDark(page)).toBe(false);
  await theme.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => saved(profileDir).theme).toBe("dark");
  await expect.poll(() => prefersDark(page)).toBe(true);
  await expect(theme.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await tondo.close();
  tondo = await launchTondo({ profileDir });
  ({ page } = tondo);
  await page.emulateMedia({ colorScheme: null });
  await expect.poll(() => prefersDark(page)).toBe(true);

  settings = await openSettings(page);
  theme = settings.getByRole("group", { name: "Theme", exact: true });
  await expect(theme.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await theme.getByRole("button", { name: "System", exact: true }).click();
  await expect.poll(() => saved(profileDir).theme).toBe("system");
  await expect(theme.getByRole("button", { name: "System", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).toBeHidden();
});

test("fewer pi processes kept running stops a hidden idle thread's pi at once", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [reply("An answer.")] } });
  const { app, page, profileDir } = tondo;
  // The page applies pi's events once a frame, and a window you can't see gets no frames.
  await bringToFront(tondo);
  const project = path.join(workDir, "project");
  mkdirSync(project);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "A question.");
  await expect(page.locator('[data-index="1"]')).toHaveText("An answer.");
  await waitForIdle(page);
  const first = await piGroup(app);

  // With the default limits, the first thread's pi keeps running out of sight.
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("heading", { level: 1, name: "New thread" })).toBeVisible();
  await waitForPi(page);
  await expect.poll(() => piGroups(app)).toHaveLength(2);
  expect(await piGroups(app)).toContain(first);

  const settings = await openSettings(page);
  await section(settings, "Threads").click();
  const kept = settings.getByLabel("pi processes kept running", { exact: true });
  await expect(kept).toHaveValue("4");
  await kept.fill("1");
  // Leaving the field saves it.
  await kept.press("Tab");
  await expect.poll(() => piGroups(app)).not.toContain(first);
  expect(processesIn([first])).toEqual([]);
  expect(await piGroups(app)).toHaveLength(1);
  await expect.poll(() => saved(profileDir).pool?.maxLive).toBe(1);

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("Command palette moves to Mod+P, and Reset gives it Mod+K back", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { page, profileDir } = tondo;
  const settings = await openSettings(page);
  await section(settings, "Shortcuts").click();
  const row = settings.getByRole("group", { name: "Command palette", exact: true });
  const change = row.getByRole("button", { name: "Change", exact: true });
  const recorder = row.getByRole("textbox", { name: "Shortcut for Command palette" });
  await expect(row.getByText(label("mod+k"), { exact: true })).toBeVisible();

  // Toggle sidebar has Mod+B, so the recorder refuses it and keeps listening,
  // and the keys don't reach the app's shortcuts.
  await change.click();
  await expect(recorder).toBeFocused();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(recorder).toBeFocused();
  await expect(threads(page)).toBeVisible();
  // Escape stops recording without closing the page.
  await page.keyboard.press("Escape");
  await expect(recorder).toBeHidden();
  await expect(row.getByRole("alert")).toBeHidden();
  await expect(change).toBeFocused();
  await expect(settings).toBeVisible();

  await change.click();
  await expect(recorder).toBeFocused();
  await page.keyboard.press("ControlOrMeta+p");
  await expect(recorder).toBeHidden();
  await expect(row.getByText(label("mod+p"), { exact: true })).toBeVisible();
  await expect(change).toBeFocused();
  await expect.poll(() => saved(profileDir).shortcuts).toEqual({ palette: "mod+p" });

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("ControlOrMeta+p");
  await expect(palette).toBeVisible();
  // Escape closes the palette, and the page stays.
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(settings).toBeVisible();

  // The app's shortcut handler marks the keys it takes, and it leaves Mod+K alone now.
  const keys = await recordKeys(page);
  await page.keyboard.press("ControlOrMeta+k");
  expect(await keys.jsonValue()).toEqual([{ key: "k", taken: false }]);
  await expect(palette).toBeHidden();

  await row.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(row.getByText(label("mod+k"), { exact: true })).toBeVisible();
  await expect.poll(() => saved(profileDir).shortcuts).toEqual({});
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
});

test("Choose pi… saves the pi you pick and shows its version", async () => {
  const chosen = installPi(path.join(workDir, "bin"));
  const missing = path.join(workDir, "missing", "pi");
  tondo = await launchTondo({ settings: { piPath: missing } });
  const { app, page, profileDir } = tondo;
  const settings = await openSettings(page);
  await section(settings, "pi").click();
  await expect(settings.getByText(missing, { exact: false })).toBeVisible({
    timeout: PI_START_TIMEOUT_MS,
  });
  await expect(settings.getByText(PI_VERSION)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("pi-missing.png") });

  await answerFolderDialog(app, chosen);
  await settings.getByRole("button", { name: "Choose pi…", exact: true }).click();
  await expect.poll(() => saved(profileDir).piPath).toBe(chosen);
  await expect(settings.getByText(PI_VERSION)).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await expect(settings.getByText(chosen, { exact: true })).toBeVisible();
  // The pi you chose is a setting, which you can go back on.
  await expect(
    settings.getByRole("button", { name: "Use pi from PATH", exact: true }),
  ).toBeVisible();
});

test("pi's settings files show in Finder", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { app, page, profileDir } = tondo;
  const global = path.join(profileDir, "pi-agent", "settings.json");
  mkdirSync(path.dirname(global), { recursive: true });
  writeFileSync(global, "{}\n");
  const revealed = await captureReveal(app);

  const settings = await openSettings(page);
  await section(settings, "pi").click();
  await expect(settings.getByText(global, { exact: true })).toBeVisible({
    timeout: PI_START_TIMEOUT_MS,
  });
  await settings
    .getByRole("button", { name: isMac ? "Show in Finder" : "Show in folder", exact: true })
    .click();
  expect(await revealed()).toBe(global);
});

test("after an outside edit to settings.json, a change in the app applies the file's theme", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({
    workDir,
    script: { responses: [] },
    profileDir,
    settings: { theme: "dark" },
  });
  const { page } = tondo;
  await page.emulateMedia({ colorScheme: null });
  await expect.poll(() => prefersDark(page)).toBe(true);

  // You edit the file while Tondo runs, then change something else in the app.
  writeFileSync(
    path.join(profileDir, "settings.json"),
    JSON.stringify({ ...saved(profileDir), theme: "light" }),
  );
  const settings = await openSettings(page);
  await section(settings, "Threads").click();
  const kept = settings.getByLabel("pi processes kept running", { exact: true });
  await kept.fill("2");
  await kept.press("Tab");
  await expect.poll(() => saved(profileDir).pool?.maxLive).toBe(2);

  await section(settings, "Appearance").click();
  await expect(
    settings
      .getByRole("group", { name: "Theme", exact: true })
      .getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => prefersDark(page)).toBe(false);
});

test("pi starts though settings.json has mistakes, and Tondo offers to show the file", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { app, page, profileDir } = tondo;
  const file = path.join(profileDir, "settings.json");
  // A newer Tondo's shortcut, and values this version refuses, written while Tondo runs.
  writeFileSync(
    file,
    JSON.stringify({
      ...saved(profileDir),
      theme: "sepia",
      pool: { maxLive: 9999 },
      shortcuts: { "toggle-terminal": "mod+j" },
    }),
  );
  const revealed = await captureReveal(app);
  const project = path.join(workDir, "project");
  mkdirSync(project);
  await addProject(tondo, project);
  await waitForPi(page);

  const toast = page
    .getByRole("status")
    .filter({ hasText: `Tondo's settings file ${file} has a theme that isn't` });
  await expect(toast).toBeVisible();
  await toast
    .getByRole("button", { name: isMac ? "Show in Finder" : "Show in folder", exact: true })
    .click();
  expect(await revealed()).toBe(file);
});

/** The settings page. */
function settingsPage(page: Page): Locator {
  return page.getByRole("region", { name: "Settings", exact: true });
}

/** Opens the settings page with its shortcut, and waits until its title has focus. */
async function openSettings(page: Page): Promise<Locator> {
  // Shortcuts do nothing until main has handed the page its port to the host,
  // which also enables the sidebar's buttons.
  await expect(page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = settingsPage(page);
  await expect(settings.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  return settings;
}

/** A button in the page's list of sections. */
function section(settings: Locator, name: string): Locator {
  return settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name, exact: true });
}

/** Tondo's settings.json in `profileDir`. */
function saved(profileDir: string): {
  theme?: string;
  piPath?: string | null;
  pool?: { maxLive?: number };
  shortcuts?: Record<string, string | null>;
} {
  return JSON.parse(readFileSync(path.join(profileDir, "settings.json"), "utf8"));
}

function prefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
}

/** How a shortcut reads on this platform, as the page shows it. */
function label(text: string): string {
  const chord = parseChord(text);
  if (!chord) throw new Error(`${text} isn't a shortcut`);
  return chordLabel(chord, isMac);
}

/**
 * Records every key pressed from now on, and whether the app took it as a
 * shortcut. The app's handler, added first, prevents the default of keys it takes.
 */
function recordKeys(page: Page) {
  return page.evaluateHandle(() => {
    const keys: { key: string; taken: boolean }[] = [];
    window.addEventListener("keydown", (event) => {
      if (event.key.length === 1) keys.push({ key: event.key, taken: event.defaultPrevented });
    });
    return keys;
  });
}

/** Installs the e2e pi in `bin` the way Tondo finds pi: a `pi` command with a node beside it. */
function installPi(bin: string): string {
  mkdirSync(bin);
  symlinkSync(PI_CLI, path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  return path.join(bin, "pi");
}

/**
 * Replaces `shell.showItemInFolder` in the main process. The returned
 * function resolves with the first file passed to it.
 */
async function captureReveal(app: ElectronApplication): Promise<() => Promise<string>> {
  await app.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { tondoRevealed?: Promise<string> };
    state.tondoRevealed = new Promise((resolve) => {
      shell.showItemInFolder = (file) => resolve(file);
    });
  });
  return () =>
    app.evaluate(() => {
      const state = globalThis as typeof globalThis & { tondoRevealed?: Promise<string> };
      if (!state.tondoRevealed) throw new Error("captureReveal wasn't set up");
      return state.tondoRevealed;
    });
}
