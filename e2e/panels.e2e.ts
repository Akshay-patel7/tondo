import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchTondo, type Tondo } from "./launch";
import { addProject, bashCall, launchWithPi, reply, send, threads, waitForPi } from "./pi";

test.describe.configure({ timeout: 90_000 });
let dir: string;
let profile: string;
let env: Record<string, string>;
let tondo: Tondo | undefined;
let errors: string[];

function watchErrors(page: Page): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

function savedWidths() {
  return JSON.parse(readFileSync(path.join(profile, "settings.json"), "utf8")).panelWidths;
}

async function expectWidth(panel: Locator, width: number): Promise<void> {
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(width);
}

async function drag(handle: Locator, delta: number): Promise<void> {
  const box = (await handle.boundingBox())!;
  await handle.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await handle.page().mouse.down();
  await handle
    .page()
    .mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 10 });
  await handle.page().mouse.up();
}

async function geometry(page: Page) {
  return page.evaluate(() => ({
    sideways: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
    transcript: document.querySelector('[aria-label="Transcript"]')!.getBoundingClientRect().width,
  }));
}

test.beforeEach(async () => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-panels-e2e-")));
  profile = path.join(dir, "profile");
  mkdirSync(profile);
  const project = path.join(dir, "project");
  mkdirSync(project);
  const shell = path.join(dir, "shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n',
  );
  chmodSync(shell, 0o755);
  env = {
    HOME: dir,
    SHELL: shell,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PI_CODING_AGENT_DIR: path.join(dir, "pi-agent"),
    CONTEXT_MODE_DATA_DIR: path.join(dir, "context-mode"),
    TONDO_DISABLE_UPDATES: "1",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, env: { ...process.env, ...env }, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, "README.md"), "Initial\n");
  git("add", ".");
  git("commit", "-m", "initial");
  errors = [];
  tondo = await launchWithPi({
    workDir: dir,
    profileDir: profile,
    env,
    settings: { theme: "light", futurePreference: "kept" },
    script: {
      responses: [bashCall("printf 'Changed in a real turn\\n' > README.md"), reply("Updated.")],
    },
  });
  watchErrors(tondo.page);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, "Adjust the panels");
  await expect(tondo.page.getByText("Updated.", { exact: true })).toBeVisible();
  await tondo.page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(tondo.page.getByRole("button", { name: "Show diff for README.md" })).toBeVisible();
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
});

test("both sidebars resize with mouse and keyboard, keep their widths and draft after restart", async () => {
  let page = tondo!.page;
  const sidebar = threads(page);
  const changes = page.getByRole("complementary", { name: "Turn changes" });
  const left = page.getByRole("separator", { name: "Resize sidebar" });
  const right = page.getByRole("separator", { name: "Resize changes" });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expectWidth(sidebar, 256);
  await expectWidth(changes, 432);
  await drag(right, 72);
  await expectWidth(changes, 360);
  await drag(left, 34);
  await expectWidth(sidebar, 290);
  await expect.poll(savedWidths).toEqual({ sidebar: 290, changes: 360 });
  await left.focus();
  await left.press("ArrowRight");
  await expectWidth(sidebar, 306);
  await right.focus();
  await right.press("ArrowLeft");
  await expectWidth(changes, 376);
  await expect.poll(savedWidths).toEqual({ sidebar: 306, changes: 376 });
  expect((await geometry(page)).sideways).toBe(0);
  expect(
    JSON.parse(readFileSync(path.join(profile, "settings.json"), "utf8")).futurePreference,
  ).toBe("kept");
  await page.getByRole("textbox", { name: "Message" }).fill("Unsent draft survives resizing");
  await changes.getByRole("button", { name: "Close changes" }).click();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expectWidth(changes, 376);
  await sidebar.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await expectWidth(sidebar, 306);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("header h1")).toHaveText("Adjust the panels");
  await expectWidth(sidebar, 306);
  await expectWidth(changes, 376);
  await expect(page.getByRole("button", { name: "Show diff for README.md" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("resized-panels-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("resized-panels-dark.png") });

  await tondo!.close();
  tondo = await launchTondo({ profileDir: profile, env });
  page = tondo.page;
  watchErrors(page);
  await expect(page.locator("header h1")).toHaveText("Adjust the panels");
  await expectWidth(threads(page), 306);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expectWidth(page.getByRole("complementary", { name: "Turn changes" }), 376);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveText(
    "Unsent draft survives resizing",
  );
  await expect(page.getByRole("button", { name: "Show diff for README.md" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("panel resizing is bounded, cancellable and temporary on smaller windows", async () => {
  const page = tondo!.page;
  const sidebar = threads(page);
  const changes = page.getByRole("complementary", { name: "Turn changes" });
  const left = page.getByRole("separator", { name: "Resize sidebar" });
  const right = page.getByRole("separator", { name: "Resize changes" });
  const file = path.join(profile, "settings.json");
  const before = readFileSync(file, "utf8");
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await expectWidth(changes, 372);
  expect(readFileSync(file, "utf8")).toBe(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectWidth(changes, 432);
  expect(readFileSync(file, "utf8")).toBe(before);

  await right.focus();
  await right.press("Home");
  await expectWidth(changes, 280);
  await left.focus();
  await left.press("Home");
  await expectWidth(sidebar, 200);
  await drag(left, -100);
  await expectWidth(sidebar, 200);
  const sidebarMax = Number(await left.getAttribute("aria-valuemax"));
  await left.press("End");
  await expectWidth(sidebar, sidebarMax);
  await expect.poll(() => savedWidths().sidebar).toBe(sidebarMax);
  const changesMax = Number(await right.getAttribute("aria-valuemax"));
  await right.press("End");
  await expect.poll(() => savedWidths().changes).toBe(changesMax);
  await expect.poll(async () => (await geometry(page)).transcript).toBeGreaterThanOrEqual(320);
  expect((await geometry(page)).sideways).toBe(0);
  const preferred = savedWidths();
  const size = await tondo!.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getSize(),
  );
  await tondo!.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(840, 620),
  );
  await page.waitForFunction(() => window.innerWidth === 840);
  await expect(sidebar).toBeHidden();
  expect((await geometry(page)).sideways).toBe(0);
  expect((await geometry(page)).transcript).toBeGreaterThanOrEqual(320);
  expect(savedWidths()).toEqual(preferred);
  await tondo!.app.evaluate(
    ({ BrowserWindow }, saved) => BrowserWindow.getAllWindows()[0]!.setSize(saved[0]!, saved[1]!),
    size,
  );
  await expect(sidebar).toBeVisible();
  await expect.poll(savedWidths).toEqual(preferred);
  await right.press("Enter");
  await left.dblclick();
  await expectWidth(sidebar, 256);
  await expectWidth(changes, 432);
  await expect.poll(savedWidths).toEqual({ sidebar: 256, changes: 432 });

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const terminal = page.getByRole("region", { name: "Terminal", exact: true });
  const input = terminal.locator(".xterm-helper-textarea");
  const output = terminal.locator(".xterm-accessibility-tree");
  await expect(input).toBeFocused();
  await input.pressSequentially("stty size | awk '{print \"BEFORE=\" $2}'");
  await input.press("Enter");
  await expect(output).toContainText(/BEFORE=\d+/);
  const beforeColumns = Number(/BEFORE=(\d+)/.exec(await output.innerText())![1]);
  const beforeScreen = (await terminal.locator(".xterm-screen").boundingBox())!.width;
  await drag(right, 80);
  await expectWidth(changes, 352);
  await expect
    .poll(() =>
      terminal.evaluate((element) => {
        const screen = element.querySelector(".xterm-screen")!.getBoundingClientRect();
        const container = element.querySelector("[data-terminal-view]")!.getBoundingClientRect();
        return screen.right <= container.right && screen.bottom <= container.bottom;
      }),
    )
    .toBe(true);
  await expect
    .poll(async () => (await terminal.locator(".xterm-screen").boundingBox())!.width)
    .toBeGreaterThan(beforeScreen);
  await terminal.locator(".xterm-screen").click();
  await expect(input).toBeFocused();
  await input.pressSequentially("stty size | awk '{print \"AFTER=\" $2}'");
  await input.press("Enter");
  await expect(output).toContainText(/AFTER=\d+/);
  expect(Number(/AFTER=(\d+)/.exec(await output.innerText())![1])).toBeGreaterThan(beforeColumns);
  await page.screenshot({ path: test.info().outputPath("resized-panels-terminal.png") });
  expect(errors).toEqual([]);
});

test("a failed width save restores the saved layout and reports the error", async () => {
  const page = tondo!.page;
  const file = path.join(profile, "settings.json");
  writeFileSync(file, "{");
  await drag(page.getByRole("separator", { name: "Resize changes" }), 60);
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't save panel width." }),
  ).toBeVisible();
  await expectWidth(page.getByRole("complementary", { name: "Turn changes" }), 432);
  expect(readFileSync(file, "utf8")).toBe("{");
  expect(errors).toEqual([]);
});
