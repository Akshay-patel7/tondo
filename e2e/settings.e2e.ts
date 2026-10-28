// The settings page with the real pi, offline with the faux model: the theme
// and the palettes across a relaunch, pool limits applied live, rebinding a
// shortcut, choosing pi, and showing pi's settings files.
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
  toolCalls,
  waitForIdle,
  waitForPi,
} from "./pi";
import { piGroup, piGroups, processesIn } from "./processes";
import { expectPicked, pickOption } from "./ui";

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

  await back(page).click();
  await expect(settings).toBeHidden();
});

test("expanded thinking applies to every section, preserves individual toggles during streaming, and survives a relaunch", async () => {
  const profileDir = path.join(workDir, "profile");
  const project = path.join(workDir, "project");
  mkdirSync(profileDir);
  mkdirSync(project);
  const first = {
    ...reply("First reply."),
    content: [
      { type: "thinking" as const, thinking: "", thinkingSignature: "opaque-test-signature" },
      { type: "thinking" as const, thinking: "First thought." },
      { type: "text" as const, text: "First reply." },
      { type: "thinking" as const, thinking: " \n\t " },
      { type: "thinking" as const, thinking: "Second thought." },
      { type: "text" as const, text: "Second reply." },
      { type: "thinking" as const, thinking: "" },
    ],
  };
  const streaming = {
    ...reply("Streaming finished."),
    content: [
      { type: "thinking" as const, thinking: "Thinking while streaming. ".repeat(50) },
      { type: "text" as const, text: "Streaming finished." },
      { type: "thinking" as const, thinking: "" },
    ],
  };
  tondo = await launchWithPi({
    workDir,
    profileDir,
    settings: { theme: "light" },
    script: { tokensPerSecond: 120, responses: [first, streaming] },
  });
  let { page } = tondo;
  await page.emulateMedia({ colorScheme: null });
  const errors: string[] = [];
  const watchErrors = (current: Page) => {
    current.on("pageerror", (error) => errors.push(error.message));
    current.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watchErrors(page);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Think twice");
  await expect(page.getByText("Second reply.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  let thoughts = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Thought" }) });
  await expect(thoughts).toHaveCount(2);
  expect(
    await thoughts.evaluateAll((nodes) =>
      nodes.every((node) => !(node as HTMLDetailsElement).open),
    ),
  ).toBe(true);

  let settings = await openSettings(page);
  let toggle = settings.getByRole("switch", { name: "Expand thinking sections", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => saved(profileDir).expandThinking).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("expanded-thinking-settings-light.png"),
    animations: "disabled",
  });
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => prefersDark(page)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("expanded-thinking-settings-dark.png"),
    animations: "disabled",
  });
  await back(page).click();
  await expect(thoughts).toHaveCount(2);
  await expect
    .poll(() =>
      thoughts.evaluateAll((nodes) => nodes.every((node) => (node as HTMLDetailsElement).open)),
    )
    .toBe(true);
  await expect(page.getByText("First thought.", { exact: true })).toBeVisible();
  await expect(page.getByText("Second thought.", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("expanded-thinking-transcript.png"),
    animations: "disabled",
  });
  await thoughts.first().locator("summary").click();
  await expect(thoughts.first()).not.toHaveAttribute("open");
  await expect(thoughts.last()).toHaveAttribute("open");
  await thoughts.first().locator("summary").press("Enter");
  await expect(thoughts.first()).toHaveAttribute("open");

  await send(page, "Think while streaming");
  await expect(thoughts).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();
  await expect(thoughts.last()).toHaveAttribute("open");
  await thoughts.last().locator("summary").click();
  await expect(thoughts.last()).not.toHaveAttribute("open");
  await expect(page.getByText("Streaming finished.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await expect(thoughts.last()).not.toHaveAttribute("open");

  await tondo.close();
  tondo = await launchTondo({ profileDir });
  ({ page } = tondo);
  watchErrors(page);
  await waitForPi(page);
  thoughts = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Thought" }) });
  await expect(thoughts).toHaveCount(3);
  expect(await thoughts.locator("div").allTextContents()).toEqual([
    "First thought.",
    "Second thought.",
    "Thinking while streaming. ".repeat(50),
  ]);
  await expect
    .poll(() =>
      thoughts.evaluateAll((nodes) => nodes.every((node) => (node as HTMLDetailsElement).open)),
    )
    .toBe(true);
  settings = await openSettings(page);
  toggle = settings.getByRole("switch", { name: "Expand thinking sections", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => saved(profileDir).expandThinking).toBe(false);
  await back(page).click();
  await expect
    .poll(() =>
      thoughts.evaluateAll((nodes) => nodes.every((node) => !(node as HTMLDetailsElement).open)),
    )
    .toBe(true);
  await thoughts.first().locator("summary").click();
  await expect(page.getByText("First thought.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("each palette colors the window in light and dark, stays after a relaunch, and leaves the theme alone", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  // A settings.json from before there were palettes.
  tondo = await launchWithPi({
    workDir,
    script: { responses: [] },
    profileDir,
    settings: { theme: "light" },
  });
  let { page } = tondo;
  await page.emulateMedia({ colorScheme: null });
  let settings = await openSettings(page);
  expect(saved(profileDir).palette).toBeUndefined();
  await expect(paletteItem(settings, "default")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "default");

  const looks = { light: new Map<Palette, Look>(), dark: new Map<Palette, Look>() };
  await (["light", "dark"] as const).reduce(async (previousScheme, scheme) => {
    await previousScheme;
    await pickTheme(page, settings, profileDir, scheme);
    await PALETTES.reduce(async (previousPalette, palette) => {
      await previousPalette;
      looks[scheme].set(palette, await showPalette(page, settings, profileDir, palette, scheme));
    }, Promise.resolve());
    // No two palettes look alike.
    const surfaces = [...looks[scheme].values()].map((look) =>
      [look.background, look.card, look.sidebar, look.primary].join(" "),
    );
    expect(new Set(surfaces).size).toBe(PALETTES.length);
  }, Promise.resolve());
  // Each palette has its own dark colors, so none of its light ones shows in dark.
  for (const palette of PALETTES) {
    const [light, dark] = [looks.light.get(palette)!, looks.dark.get(palette)!];
    expect(
      COLORS.filter((name) => light[name] === dark[name]),
      `${palette}'s colors that dark doesn't change`,
    ).toEqual([]);
  }

  await minimumSize(tondo);
  await (["dark", "light"] as const).reduce(async (previousScheme, scheme) => {
    await previousScheme;
    await pickTheme(page, settings, profileDir, scheme);
    await PALETTES.reduce(async (previousPalette, palette) => {
      await previousPalette;
      await showPalette(page, settings, profileDir, palette, scheme, "-minimum");
    }, Promise.resolve());
  }, Promise.resolve());

  await pickTheme(page, settings, profileDir, "dark");
  await PALETTES.reduce(async (previousPalette, palette) => {
    await previousPalette;
    await pickPalette(page, settings, profileDir, palette);
    await tondo!.close();
    tondo = await launchTondo({ profileDir });
    ({ page } = tondo);
    await page.emulateMedia({ colorScheme: null });
    // Saved palettes apply before the settings page opens.
    await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
    await expect.poll(() => prefersDark(page)).toBe(true);
    expect(await colors(page)).toEqual(looks.dark.get(palette));
    await expectWindowPalette(tondo.app, (await colors(page)).background);
    settings = await openSettings(page);
    await expect(paletteItem(settings, palette)).toHaveAttribute("aria-pressed", "true");
  }, Promise.resolve());

  await pickPalette(page, settings, profileDir, "ocean");
  await pickTheme(page, settings, profileDir, "system");
  expect(saved(profileDir).palette).toBe("ocean");
});

test("diffs and code blocks stay legible in every palette, in light and dark", async () => {
  const project = path.join(workDir, "project");
  mkdirSync(project);
  writeFileSync(
    path.join(project, "total.ts"),
    "export function total(items: number[]): number {\n  let sum = 0;\n  for (const item of items) sum += item;\n  return sum; // the total\n}\n",
  );
  tondo = await launchWithPi({
    workDir,
    script: {
      responses: [
        toolCalls({
          id: "call_double",
          name: "edit",
          arguments: {
            path: "total.ts",
            // A changed line, so the diff highlights the words that changed too.
            edits: [
              {
                oldText: "  return sum; // the total\n",
                newText:
                  '  if (items.length === 0) return -1;\n  return sum * 2; // twice "the total"\n',
              },
            ],
          },
        }),
        reply(
          'Doubled:\n\n```ts\n// Twice the total, or -1 for no items.\nconst doubled = total([1, 2.5, 3]);\nconsole.log("total:", doubled);\n```',
        ),
      ],
    },
  });
  const { page, profileDir } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Double it.");
  await expect(page.getByText("Doubled:")).toBeVisible();

  const edited = page.locator('[data-tool-call="call_double"]');
  const block = page.locator('[data-streamdown="code-block-body"]');
  await edited.getByRole("button").first().click();
  await PALETTES.reduce(async (previousPalette, palette) => {
    await previousPalette;
    await expectCodeLegible(page, profileDir, palette, edited, block);
  }, Promise.resolve());
});

test("the terminal takes the palette's colors whenever it changes", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { page, profileDir } = tondo;
  await bringToFront(tondo);
  const project = path.join(workDir, "project");
  mkdirSync(project);
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  const warm = await terminalOnBackground(page);

  // The settings page takes the thread's place, so the terminal comes back in the new palette.
  // Linux leaves Ctrl shortcuts to the focused shell; use the sidebar instead.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = settingsPage(page);
  await expect(settings.getByRole("heading", { level: 2 })).toBeFocused();
  await pickPalette(page, settings, profileDir, "ocean");
  await back(page).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  const ocean = await terminalOnBackground(page);
  expect(ocean).not.toBe(warm);

  // A palette that changes while the terminal is open, the way App.tsx applies one.
  await page.evaluate(() => {
    document.documentElement.dataset.palette = "rose";
  });
  const rose = await terminalOnBackground(page);
  expect([warm, ocean]).not.toContain(rose);
});

test("new threads use saved model and thinking defaults without changing existing sessions", async () => {
  const profileDir = path.join(workDir, "profile");
  const project = path.join(workDir, "project");
  mkdirSync(profileDir);
  mkdirSync(project);
  tondo = await launchWithPi({
    workDir,
    profileDir,
    settings: { theme: "light" },
    script: { responses: [reply("Saved answer.")] },
  });
  await bringToFront(tondo);
  let { page } = tondo;
  await page.emulateMedia({ colorScheme: null });
  await addProject(tondo, project);
  await waitForPi(page);
  await pickOption(page, "Thinking level", "Low thinking");
  await send(page, "Original thread");
  await expect(page.getByText("Saved answer.", { exact: true })).toBeVisible();
  await waitForIdle(page);

  let settings = await openSettings(page);
  await section(settings, "Threads").click();
  await expectPicked(settings, "Default model", "pi-default");
  await expectPicked(settings, "Default thinking level", "pi-default");
  await pickOption(settings, "Default model", "Faux 1");
  await pickOption(settings, "Default thinking level", "High thinking");
  await expect
    .poll(() => saved(profileDir))
    .toMatchObject({
      defaultModel: { provider: "faux", id: "faux-1" },
      defaultThinkingLevel: "high",
    });
  await page.screenshot({
    path: test.info().outputPath("thread-defaults-light.png"),
    animations: "disabled",
  });
  await section(settings, "Appearance").click();
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => prefersDark(page)).toBe(true);
  await section(settings, "Threads").click();
  await page.screenshot({
    path: test.info().outputPath("thread-defaults-dark.png"),
    animations: "disabled",
  });
  await back(page).click();
  await expectPicked(page, "Model", "faux/faux-1");
  await expectPicked(page, "Thinking level", "low");

  await page.keyboard.press("ControlOrMeta+n");
  await waitForPi(page);
  await expectPicked(page, "Model", "faux/faux-1");
  await expectPicked(page, "Thinking level", "high");
  // A per-thread override remains independent of the saved defaults.
  await pickOption(page, "Thinking level", "Minimal thinking");
  await page.reload();
  await waitForPi(page);
  await expectPicked(page, "Thinking level", "minimal");

  settings = await openSettings(page);
  await section(settings, "Threads").click();
  await expectPicked(settings, "Default thinking level", "high");
  await pickOption(settings, "Default model", "Faux 2");
  await back(page).click();
  await page.keyboard.press("ControlOrMeta+n");
  await waitForPi(page);
  await expectPicked(page, "Model", "faux/faux-2");
  // Faux 2 has no reasoning. pi clamps the saved high level to off.
  await expect(page.getByRole("combobox", { name: "Thinking level", exact: true })).toBeHidden();
  await send(page, "Non-reasoning thread");
  await expect(page.getByText("Saved answer.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await threads(page).getByRole("button", { name: "Original thread", exact: true }).click();
  await waitForPi(page);
  await expectPicked(page, "Model", "faux/faux-1");
  await expectPicked(page, "Thinking level", "low");

  await tondo.close();
  tondo = await launchTondo({ profileDir });
  ({ page } = tondo);
  await waitForPi(page);
  await expectPicked(page, "Model", "faux/faux-1");
  await expectPicked(page, "Thinking level", "low");
  settings = await openSettings(page);
  await section(settings, "Threads").click();
  await expectPicked(settings, "Default model", "faux/faux-2");
  await expectPicked(settings, "Default thinking level", "high");
  await pickOption(settings, "Default model", "Use pi's default");
  await pickOption(settings, "Default thinking level", "Use pi's default");
  await expect
    .poll(() => saved(profileDir))
    .toMatchObject({
      defaultModel: null,
      defaultThinkingLevel: null,
    });
});

test("an unavailable default model can be cleared before opening a project", async () => {
  tondo = await launchWithPi({
    workDir,
    script: { responses: [] },
    settings: {
      defaultModel: { provider: "missing", id: "old-model" },
      defaultThinkingLevel: "max",
    },
  });
  const { page, profileDir } = tondo;
  const settings = await openSettings(page);
  await section(settings, "Threads").click();
  await expectPicked(settings, "Default model", "missing/old-model");
  await expectPicked(settings, "Default thinking level", "max");
  await pickOption(settings, "Default model", "Use pi's default");
  await pickOption(settings, "Default thinking level", "Use pi's default");
  await expect
    .poll(() => saved(profileDir))
    .toMatchObject({ defaultModel: null, defaultThinkingLevel: null });
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
  const row = settings.getByRole("group", { name: "Search", exact: true });
  // The key cap shows the shortcut, and pressing it records a new one.
  const change = row.getByRole("button", { name: /^Change shortcut, / });
  const recorder = row.getByRole("textbox", { name: "Shortcut for Search" });
  await expect(row.getByText(label("mod+k"), { exact: true })).toBeVisible();
  await expect(change).toHaveAccessibleName(`Change shortcut, ${label("mod+k")}`);

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
  await expect(change).toHaveAccessibleName(`Change shortcut, ${label("mod+p")}`);
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

/**
 * Opens the settings page with its shortcut, and waits until its section's
 * heading has focus. The page's title is in the header.
 */
async function openSettings(page: Page): Promise<Locator> {
  // Shortcuts do nothing until main has handed the page its port to the host,
  // which also enables the sidebar's buttons.
  await expect(page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = settingsPage(page);
  await expect(settings.getByRole("heading", { level: 2 })).toBeFocused();
  return settings;
}

/** The header's Back, which shows while the settings page is open. */
function back(page: Page): Locator {
  return page.locator("header").getByRole("button", { name: "Back", exact: true });
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
  palette?: string;
  expandThinking?: boolean;
  defaultModel?: { provider: string; id: string } | null;
  defaultThinkingLevel?: string | null;
  piPath?: string | null;
  pool?: { maxLive?: number };
  shortcuts?: Record<string, string | null>;
} {
  return JSON.parse(readFileSync(path.join(profileDir, "settings.json"), "utf8"));
}

function prefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
}

/** The page's color-scheme, which native controls and scrollbars follow. */
function colorScheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

const PALETTES = ["default", "slate", "ocean", "rose"] as const;
type Palette = (typeof PALETTES)[number];

const PALETTE_NAMES: Record<Palette, string> = {
  default: "Default",
  slate: "Slate",
  ocean: "Ocean",
  rose: "Rose",
};

const THEME_NAMES = { system: "System", light: "Light", dark: "Dark" } as const;

/** A palette's button on the settings page. */
function paletteItem(settings: Locator, palette: Palette): Locator {
  return settings
    .getByRole("group", { name: "Palette", exact: true })
    .getByRole("button", { name: PALETTE_NAMES[palette], exact: true });
}

/** Picks `palette` on the settings page, and waits until it's saved and on the page. */
async function pickPalette(
  page: Page,
  settings: Locator,
  profileDir: string,
  palette: Palette,
): Promise<void> {
  const item = paletteItem(settings, palette);
  // Clicking the pressed one would unpress it, which changes nothing.
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => saved(profileDir).palette ?? "default").toBe(palette);
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
}

/** Picks `theme` on the settings page, and waits until it's saved and the page has its scheme. */
async function pickTheme(
  page: Page,
  settings: Locator,
  profileDir: string,
  theme: keyof typeof THEME_NAMES,
): Promise<void> {
  const item = settings
    .getByRole("group", { name: "Theme", exact: true })
    .getByRole("button", { name: THEME_NAMES[theme], exact: true });
  const palette = saved(profileDir).palette ?? "default";
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => saved(profileDir).theme ?? "system").toBe(theme);
  if (theme !== "system") await expect.poll(() => prefersDark(page)).toBe(theme === "dark");
  // The theme leaves the palette as it was.
  expect(saved(profileDir).palette ?? "default").toBe(palette);
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
}

/**
 * Picks `palette` while `scheme` is the theme, checks that the theme stays and
 * the colors reach their contrast, and photographs the window. Returns the colors.
 */
async function showPalette(
  page: Page,
  settings: Locator,
  profileDir: string,
  palette: Palette,
  scheme: "light" | "dark",
  suffix = "",
): Promise<Look> {
  await pickPalette(page, settings, profileDir, palette);
  // The palette leaves the theme as it was, and native controls follow the scheme.
  expect(saved(profileDir).theme).toBe(scheme);
  expect(await prefersDark(page)).toBe(scheme === "dark");
  expect(await colorScheme(page)).toBe("light dark");
  const look = await colors(page);
  expect(shortContrast(look), `${palette} in ${scheme}`).toEqual([]);
  if (!tondo) throw new Error("No Tondo window to check");
  await expectWindowPalette(tondo.app, look.background);
  await capture(page, `palette-${palette}-${scheme}${suffix}`);
  return look;
}

/** The native backdrop and the renderer must ship the same palette colors. */
async function expectWindowPalette(app: ElectronApplication, background: string): Promise<void> {
  const expected =
    "#" +
    background
      .split(",")
      .slice(0, 3)
      .map((byte) => Number(byte).toString(16).padStart(2, "0"))
      .join("");
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error("No Tondo window to check");
        return window.getBackgroundColor().toLowerCase();
      }),
    )
    .toBe(expected);
}

/**
 * Picks `palette` on the settings page and goes back to the thread, then waits
 * until all text in `edited`'s diff and in the code `block` reaches 4.5:1 in
 * each scheme, and photographs the window in each.
 */
async function expectCodeLegible(
  page: Page,
  profileDir: string,
  palette: Palette,
  edited: Locator,
  block: Locator,
): Promise<void> {
  if (palette !== "default") {
    const settings = await openSettings(page);
    await pickPalette(page, settings, profileDir, palette);
    await back(page).click();
    await expect(settings).toBeHidden();
  }
  // The card stays open while the settings page has the thread's place.
  await expect(edited.getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
  await waitForHighlighting(edited);
  // Until Shiki has colored the block, its text takes the page's color.
  await expect(block.locator('span[style*="--shiki-dark"]').first()).toBeAttached();
  const diff = edited.getByRole("region", { name: "Diff" });
  await expectLegible(page, "light", diff, block);
  await capture(page, `palette-${palette}-light-diff`);
  await expectLegible(page, "dark", diff, block);
  await capture(page, `palette-${palette}-dark-diff`);
}

/** Every color a palette sets (index.css), and the ones that point at them. */
const COLORS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "message",
  "message-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "destructive",
  "destructive-foreground",
  "warning",
  "warning-foreground",
  "success",
  "success-foreground",
  "info",
  "info-foreground",
  "addition",
  "deletion",
  "border",
  "input",
  "control-border",
  "ring",
  "sidebar",
] as const;
type Look = Record<(typeof COLORS)[number], string>;

/**
 * The page's colors as the sRGB bytes it paints, "r,g,b,a". A canvas converts
 * them, as terminalTheme in TerminalDrawer.tsx does.
 */
async function colors(page: Page): Promise<Look> {
  const look = await page.evaluate((names) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const found: Record<string, string> = {};
    for (const name of names) {
      probe.style.color = `var(--${name})`;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      found[name] = context.getImageData(0, 0, 1, 1).data.join(",");
    }
    probe.remove();
    return found;
  }, COLORS);
  return look as Look;
}

/**
 * Text on the surfaces it sits on reaches 4.5:1, and control edges and the
 * focus ring 3:1. A translucent fill, such as the --accent hover wash, is
 * measured as it paints: [fill, surface] puts it over each surface it washes.
 */
const CONTRASTS: readonly (readonly [
  keyof Look,
  keyof Look | readonly [keyof Look, keyof Look],
  number,
])[] = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "sidebar", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "sidebar", 4.5],
  ["accent-foreground", ["accent", "background"], 4.5],
  ["accent-foreground", ["accent", "card"], 4.5],
  ["accent-foreground", ["accent", "sidebar"], 4.5],
  ["primary-foreground", "primary", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["success-foreground", "success", 4.5],
  ["info-foreground", "info", 4.5],
  ["addition", "card", 4.5],
  ["deletion", "card", 4.5],
  ["control-border", "background", 3],
  ["control-border", "card", 3],
  ["ring", "background", 3],
];

/** The pairs in CONTRASTS that `look` paints under their ratio. */
function shortContrast(look: Look): string[] {
  return CONTRASTS.flatMap(([ink, paper, least]) => {
    const [fill, surface] = typeof paper === "string" ? [paper, undefined] : paper;
    const painted = surface === undefined ? look[fill] : over(look[fill], look[surface]);
    const ratio = contrast(look[ink], painted);
    const name = surface === undefined ? fill : `${fill} over ${surface}`;
    return ratio < least ? [`${ink} on ${name} at ${ratio.toFixed(2)}:1`] : [];
  });
}

/** The opaque "r,g,b,a" color that `top`, which may be translucent, paints over `base`. */
function over(top: string, base: string): string {
  const [red, green, blue, alpha] = top.split(",").map(Number);
  const opacity = alpha! / 255;
  return [red!, green!, blue!]
    .map((channel, i) => Math.round(channel * opacity + Number(base.split(",")[i]) * (1 - opacity)))
    .concat(255)
    .join(",");
}

/** WCAG 2's contrast ratio between two opaque "r,g,b,a" colors. */
function contrast(a: string, b: string): number {
  const [x, y] = [a, b].map((color) => {
    const [red, green, blue] = color.split(",").map((byte) => {
      const channel = Number(byte) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  });
  return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05);
}

/** A picture of the window for the palette QA, in the test's output folder. */
async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

/** Sizes the window to its 840x620 minimum, as layout.e2e.ts does. */
async function minimumSize({ app, page }: Tondo): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(840, 620));
  await page.waitForFunction(() => window.innerWidth === 840 && window.innerHeight === 620);
}

/**
 * Waits until the terminal's background is the page's --background, which
 * TerminalDrawer.tsx gives xterm's theme and xterm paints its viewport with,
 * and returns that color.
 */
async function terminalOnBackground(page: Page): Promise<string> {
  let background = "";
  await expect
    .poll(async () => {
      const found = await page
        .locator("[data-terminal-view] .xterm-scrollable-element")
        .first()
        .evaluate((viewport) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true })!;
          const bytes = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return context.getImageData(0, 0, 1, 1).data.join(",");
          };
          const probe = document.createElement("span");
          probe.style.color = "var(--background)";
          document.body.append(probe);
          const backdrop = bytes(getComputedStyle(probe).color);
          probe.remove();
          return { terminal: bytes(getComputedStyle(viewport).backgroundColor), backdrop };
        });
      background = found.terminal;
      return found.terminal === found.backdrop;
    })
    .toBe(true);
  return background;
}

/** What a highlighted code view shows once a worker has colored it, as in tools.e2e.ts. */
async function waitForHighlighting(of: Locator): Promise<void> {
  await expect
    .poll(() =>
      of
        .locator("diffs-container")
        .evaluate(
          (host) => host.shadowRoot?.querySelector('span[style*="--diffs-token"]') !== null,
        ),
    )
    .toBe(true);
}

/** Switches the page to `scheme`, then waits until all text under `roots` reaches 4.5:1. */
async function expectLegible(
  page: Page,
  scheme: "light" | "dark",
  ...roots: Locator[]
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await Promise.all(roots.map((root) => expect.poll(() => illegibleText(root)).toEqual([])));
}

/**
 * The text under `root`, shadow roots included, that's under WCAG AA's 4.5:1
 * against what's behind it, as tools.e2e.ts measures it. Colors go through a
 * canvas, so lab() and color-mix() come out as the sRGB the page paints.
 */
function illegibleText(root: Locator): Promise<string[]> {
  return root.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const page = rgba(getComputedStyle(document.documentElement).getPropertyValue("--background"));
    const failing: string[] = [];
    const visit = (scope: Node) => {
      if (scope instanceof Element && scope.shadowRoot) visit(scope.shadowRoot);
      const walker = document.createTreeWalker(
        scope,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node instanceof Element && node.shadowRoot) visit(node.shadowRoot);
        const text = node.nodeType === Node.TEXT_NODE ? node.textContent?.trim() : "";
        const at = node.parentElement;
        if (!text || !at?.checkVisibility()) continue;
        const chain: Element[] = [];
        for (
          let ancestor: Element | null = at;
          ancestor;
          ancestor = ancestor.parentElement ?? (ancestor.getRootNode() as ShadowRoot).host ?? null
        ) {
          chain.unshift(ancestor);
        }
        let behind = page.slice(0, 3);
        let opacity = 1;
        for (const ancestor of chain) {
          const style = getComputedStyle(ancestor);
          const fill = rgba(style.backgroundColor);
          behind = behind.map((value, i) => fill[i]! * fill[3]! + value * (1 - fill[3]!));
          opacity *= Number(style.opacity);
        }
        const ink = rgba(getComputedStyle(at).color);
        const alpha = ink[3]! * opacity;
        const shown = behind.map((value, i) => ink[i]! * alpha + value * (1 - alpha));
        const [a, b] = [shown, behind].map((color) =>
          [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
            const channel = color[i]! / 255;
            const linear =
              channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            return sum + weight * linear;
          }, 0),
        );
        const ratio = (Math.max(a!, b!) + 0.05) / (Math.min(a!, b!) + 0.05);
        if (ratio < 4.5) failing.push(`"${text.slice(0, 24)}" at ${ratio.toFixed(2)}:1`);
      }
    };
    visit(element);
    return failing;
  });
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
