// The layout at the window's 840x620 minimum, at its default size and at 200%
// zoom, with the real pi offline: a long folder name in the header, Changes
// and the terminal beside a usable thread, the sidebar stepping aside when the
// window has no room for it, toasts kept off the composer and an extension's
// dialog, and many extension status entries wrapping under the composer.
// Screenshots go to test-results/layout/.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { addProject, launchWithPi, reply, send, threads, waitForPi } from "./pi";

test.describe.configure({ timeout: 90_000 });

const SHOTS = path.resolve(__dirname, "../test-results/layout");
const LONG_NAME = "acme-web-platform-monorepo-with-a-very-long-folder-name-for-header-tests";

/**
 * /tondo-toasts raises three toasts. They're errors, which stay until you
 * close them, so none times out while the test measures. /tondo-long-select
 * asks with thirty long options, a dialog taller than the minimum window has
 * room for beside the transcript.
 */
const TOAST_EXTENSION = `
export default function toastExtension(pi) {
  pi.registerCommand("tondo-toasts", {
    description: "Raises three toasts",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Saved the session to /tmp/sessions/2026-10-11.jsonl", "error");
      ctx.ui.notify("Context is 91% full. Older turns will be compacted soon: /Users/someone/Development/a-really-long-folder-name-without-any-spaces-at-all/and/a/deep/path/to/file.ts", "error");
      ctx.ui.notify("lint-on-save failed:\\neslint exited with code 2\\n  src/parser.ts:14:3  error  Unexpected trailing comma  comma-dangle", "error");
    },
  });
  pi.registerCommand("tondo-long-select", {
    description: "Asks with thirty long options",
    handler: async (_args, ctx) => {
      const options = Array.from({ length: 30 }, (_, i) => "Option " + (i + 1) + ": deploy the build to the staging environment named staging-cluster-" + (i + 1) + "-eu-west");
      await ctx.ui.select("Which of these thirty staging environments should receive the build that was just produced by the pipeline?", options);
    },
  });
}
`;

/** Nine status entries, more than one line holds, with emoji and text as extensions post them. */
const STATUS_ENTRIES: readonly (readonly [key: string, text: string])[] = [
  ["usage", "🧠 5h 2% · wk 0% · fable 0%"],
  ["soul", "✦ soul: global"],
  ["context", "📦 38% of 200k tokens"],
  ["model", "🤖 faux-1 · medium thinking"],
  ["lint", "✅ lint clean · 0 warnings"],
  ["tests", "🧪 742 passed · 0 failed"],
  ["branch", "⎇ feature/a-long-branch-name-that-needs-room"],
  ["clock", "⏱ 12:34 · session 1h 02m"],
  ["mood", "😀 all good"],
];

/** /tondo-statuses posts STATUS_ENTRIES as the extension's status line. */
const STATUS_EXTENSION = `
export default function statusExtension(pi) {
  pi.registerCommand("tondo-statuses", {
    description: "Posts many status entries",
    handler: async (_args, ctx) => {
      for (const [key, text] of ${JSON.stringify(STATUS_ENTRIES)}) ctx.ui.setStatus(key, text);
    },
  });
}
`;

let dir: string;
let env: Record<string, string>;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-layout-e2e-")));
  env = {
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  // The login shell and the terminal's shell are plain sh, without the developer's dotfiles.
  const shell = path.join(dir, "shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n',
  );
  chmodSync(shell, 0o755);
  env.SHELL = shell;
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** A Git checkout named `name` with one commit, so the header shows the Git controls and the status row its Git pill. */
function gitProject(name: string): string {
  const project = path.join(dir, name);
  mkdirSync(project);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, env, encoding: "utf8", stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, "README.md"), "Initial\n");
  git("add", ".");
  git("commit", "-m", "initial");
  return project;
}

/** Launches Tondo with the faux pi, adds `project` and waits until its pi takes prompts. */
async function launch(project: string, { piArgs = [] }: { piArgs?: string[] } = {}): Promise<Page> {
  tondo = await launchWithPi({
    workDir: dir,
    env,
    script: { responses: [reply("Ready.")] },
    piArgs,
  });
  // The page applies pi's events once a frame, and a window you can't see gets no frames.
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  return tondo.page;
}

/** Sizes the window to its 840x620 minimum. */
async function minimumSize({ app, page }: Tondo): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(840, 620));
  await page.waitForFunction(() => window.innerWidth === 840 && window.innerHeight === 620);
}

/** Zooms the page as View > Zoom In does, and waits until the page has the narrower width. */
async function zoom({ app, page }: Tondo, factor: number): Promise<void> {
  const width = await app.evaluate(({ BrowserWindow }, zoomFactor) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]!;
    browserWindow.webContents.setZoomFactor(zoomFactor);
    return browserWindow.getContentSize()[0]! / zoomFactor;
  }, factor);
  await page.waitForFunction((expected) => Math.abs(window.innerWidth - expected) <= 1, width);
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Where the thread's parts are, and how far the page scrolls sideways. */
function measure(page: Page) {
  return page.evaluate(() => {
    const [transcript, terminal] = [
      '[role="region"][aria-label="Transcript"]',
      'section[aria-label="Terminal"]',
    ].map(
      (selector): Box | null =>
        document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null,
    );
    const root = document.scrollingElement!;
    return {
      sideways: root.scrollWidth - root.clientWidth,
      scrolledLeft: root.scrollLeft,
      transcript,
      terminal,
    };
  });
}

/**
 * The header's buttons that end past the window's right edge, and how wide
 * the thread's title is next to the width its text needs.
 */
function headerFit(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header")!;
    const title = header.querySelector("h1")!;
    const text = document.createRange();
    text.selectNodeContents(title);
    return {
      offScreen: [...header.querySelectorAll("button")]
        .filter((button) => button.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? ""),
      titleWidth: title.getBoundingClientRect().width,
      titleTextWidth: text.getBoundingClientRect().width,
    };
  });
}

/** Expects the header's buttons inside the window, the title whole, and no sideways scroll. */
async function expectHeaderFits(page: Page, state: string): Promise<void> {
  const fit = await headerFit(page);
  const { sideways, scrolledLeft } = await measure(page);
  expect.soft(sideways, `the page scrolls sideways at ${state}`).toBe(0);
  expect.soft(scrolledLeft, `the page is scrolled sideways at ${state}`).toBe(0);
  expect.soft(fit.offScreen, `header buttons past the window's edge at ${state}`).toEqual([]);
  expect
    .soft(fit.titleWidth, `the thread's title is cut at ${state}`)
    .toBeGreaterThanOrEqual(fit.titleTextWidth - 0.5);
}

test("a long folder name gives way to the thread's title and the header's buttons", async () => {
  const page = await launch(gitProject(LONG_NAME));
  const folder = page.locator("header span[title]");
  await expect(folder).toHaveText(LONG_NAME);
  await expectHeaderFits(page, "the default size");

  await minimumSize(tondo!);
  await expectHeaderFits(page, "the minimum size");
  const cut = await folder.evaluate((element) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    return text.getBoundingClientRect().width - element.getBoundingClientRect().width;
  });
  expect(cut, "the folder name is cut to fit").toBeGreaterThan(0);
  await page.screenshot({ path: path.join(SHOTS, "long-folder-name-minimum.png") });

  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Turn changes" })).toBeVisible();
  await expectHeaderFits(page, "the minimum size with Changes open");
  await page.screenshot({ path: path.join(SHOTS, "long-folder-name-minimum-changes.png") });
});

for (const size of ["default", "minimum", "zoomed"] as const) {
  test(`a long thread title leaves room for the branch and usable header controls at ${size} size`, async () => {
    mkdirSync(SHOTS, { recursive: true });
    const page = await launch(gitProject("project"));
    await page.emulateMedia({ colorScheme: "dark" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await send(page, "First.");
    const header = page.locator("header");
    await expect(header.getByRole("heading")).toHaveText("First.");
    await threads(page).getByTitle("First.", { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const title =
      "In tondo the pi plugins area is looking a bit weird. Also can you add git pull support?";
    const input = page.getByRole("textbox", { name: "Thread title" });
    await input.fill(title);
    await input.press("Enter");
    await expect(header.getByRole("heading")).toHaveText(title);
    await expect(threads(page).getByTitle(title, { exact: true })).toBeVisible();
    const branch = header.locator("span").filter({ hasText: /^Branch main$/ });
    await expect(branch).toBeVisible();

    if (size !== "default") await minimumSize(tondo!);
    if (size === "zoomed") await zoom(tondo!, 1.4);
    await expect
      .poll(
        async () => {
          const titleBox = await header.getByRole("heading").boundingBox();
          const branchBox = await branch.boundingBox();
          const terminalBox = await header
            .getByRole("button", { name: "Terminal", exact: true })
            .boundingBox();
          return (
            titleBox!.x + titleBox!.width <= branchBox!.x &&
            branchBox!.x + branchBox!.width <= terminalBox!.x
          );
        },
        { message: `the branch stays clear of Terminal at ${size} size` },
      )
      .toBe(true);
    const fit = await headerFit(page);
    expect(fit.offScreen).toEqual([]);
    expect((await measure(page)).sideways).toBe(0);
    expect(fit.titleWidth, "the long title truncates").toBeLessThan(fit.titleTextWidth);
    // Electron's capture keeps the whole window at non-default zoom.
    const shot = await tondo!.app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    writeFileSync(path.join(SHOTS, `long-thread-title-${size}.png`), Buffer.from(shot, "base64"));

    // Check that the controls still work beside the long title.
    await header.getByRole("button", { name: "Terminal", exact: true }).click();
    const drawer = page.getByRole("region", { name: "Terminal", exact: true });
    await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
    await drawer.getByRole("button", { name: "Close terminal" }).click();
    await expect(drawer).not.toBeAttached();
    await header.getByRole("button", { name: "Git actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Switch branch", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });
}

test("Changes at the minimum size moves the sidebar aside, and the thread and its terminal keep their room", async () => {
  const page = await launch(gitProject("project"));
  const sidebar = threads(page);
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  const panel = page.getByRole("complementary", { name: "Turn changes" });
  await minimumSize(tondo!);
  await expect(sidebar).toBeVisible();

  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expect(showSidebar).toBeVisible();
  const withChanges = await measure(page);
  expect.soft(withChanges.sideways, "the page scrolls sideways").toBe(0);
  expect.soft(withChanges.transcript!.width, "the thread's width").toBeGreaterThanOrEqual(320);
  expect
    .soft(withChanges.transcript!.height, "the transcript's height")
    .toBeGreaterThanOrEqual(150);
  await page.screenshot({ path: path.join(SHOTS, "changes-minimum.png") });

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
  const withTerminal = await measure(page);
  expect.soft(withTerminal.sideways, "the page scrolls sideways").toBe(0);
  expect.soft(withTerminal.terminal!.width, "the terminal's width").toBeGreaterThanOrEqual(320);
  expect
    .soft(withTerminal.transcript!.height, "the transcript's height beside the terminal")
    .toBeGreaterThanOrEqual(80);
  await page.screenshot({ path: path.join(SHOTS, "changes-terminal-minimum.png") });
  await drawer.getByRole("button", { name: "Close terminal" }).click();
  await expect(drawer).not.toBeAttached();

  // Shown anyway, the sidebar stays until you hide it again or Changes closes.
  await showSidebar.click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await expect(sidebar).toBeHidden();
  await panel.getByRole("button", { name: "Close changes" }).click();
  await expect(panel).not.toBeAttached();
  await expect(sidebar).toBeVisible();
});

// 200% of the default 1200x800 window is a 600x400 page. macOS CI runners fit only
// 1024x677, so the zoom that gives the same page there is a little under 200%.
test("at 200% zoom the sidebar steps aside, and the header and transcript keep their room", async () => {
  const page = await launch(gitProject("project"));
  const sidebar = threads(page);
  await expect(sidebar).toBeVisible();

  const [width, height] = await tondo!.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getContentSize(),
  );
  await zoom(tondo!, Math.min(width! / 600, height! / 400));
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeVisible();
  // A configured provider leaves room for the thread controls even at 200% zoom.
  await expect(
    page.getByRole("button", { name: "Sign in to a provider", exact: true }),
  ).toBeHidden();
  await expectHeaderFits(page, "200% zoom");
  const zoomed = await measure(page);
  expect.soft(zoomed.transcript!.height, "the transcript's height").toBeGreaterThanOrEqual(80);
  await page.screenshot({ path: path.join(SHOTS, "zoom-200.png") });

  await page.getByRole("region", { name: "Transcript", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebar).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebar).toBeHidden();

  await zoom(tondo!, 1);
  await expect(sidebar).toBeVisible();
});

/**
 * How the status row under the composer laid out: how many lines its entries
 * take, the entries outside the row's box or wider than their own, and the
 * Git pill's height and whether it's inside the row.
 */
function measureStatusRow(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('[aria-label="Extension status"]')!;
    const row = list.parentElement!.getBoundingClientRect();
    const inside = (box: DOMRect) =>
      box.left >= row.left - 0.5 &&
      box.right <= row.right + 0.5 &&
      box.top >= row.top - 0.5 &&
      box.bottom <= row.bottom + 0.5;
    const entries = [...list.querySelectorAll("li")];
    const pill = document.querySelector('[aria-label="Git status"]')!.getBoundingClientRect();
    return {
      lines: new Set(entries.map((entry) => Math.round(entry.getBoundingClientRect().top))).size,
      outside: entries
        .filter((entry) => !inside(entry.getBoundingClientRect()))
        .map((entry) => entry.dataset.status),
      overflowing: entries
        .filter((entry) => entry.scrollWidth > entry.clientWidth + 1)
        .map((entry) => entry.dataset.status),
      pillHeight: pill.height,
      pillInside: inside(pill),
    };
  });
}

test("many extension status entries wrap under the composer without clipping, and the Git pill keeps one line", async () => {
  const extension = path.join(dir, "status-ext.ts");
  writeFileSync(extension, STATUS_EXTENSION);
  const page = await launch(gitProject("project"), { piArgs: ["-e", extension] });
  const entries = page.getByLabel("Extension status").getByRole("listitem");
  await send(page, "/tondo-statuses");
  // In key order, each entry the extension's text verbatim, without its key.
  await expect(entries).toHaveText(
    STATUS_ENTRIES.toSorted(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
  );
  const fit = await measureStatusRow(page);
  expect(fit.lines, "the entries take more than one line").toBeGreaterThan(1);
  expect(fit.outside, "entries outside the status row").toEqual([]);
  expect(fit.overflowing, "entries wider than their box").toEqual([]);
  expect(fit.pillHeight, "the Git pill's height").toBeLessThanOrEqual(23);
  expect(fit.pillInside, "the Git pill is inside the status row").toBe(true);
  await page.screenshot({ path: path.join(SHOTS, "status-row-wrapping.png") });
});

/** The toasts whose boxes meet the box of the element `selector` finds, with the area they share. */
function toastsOver(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((target) => {
    const covered = document.querySelector(target)!.getBoundingClientRect();
    return [...document.querySelectorAll("[data-toast]")].flatMap((toast) => {
      const box = toast.getBoundingClientRect();
      const width = Math.min(box.right, covered.right) - Math.max(box.left, covered.left);
      const height = Math.min(box.bottom, covered.bottom) - Math.max(box.top, covered.top);
      if (width <= 0 || height <= 0) return [];
      return [`"${toast.textContent?.slice(0, 30)}" covers ${Math.round(width * height)} px²`];
    });
  }, selector);
}

// The default window is 1200x800 where the screen has room. macOS CI runners
// fit only 1024x677, so the default case takes the size the window got.
for (const size of ["default", "minimum"] as const) {
  test(`at the ${size} size toasts stay in the transcript, off the composer and an extension's dialog`, async () => {
    const extension = path.join(dir, "toast-ext.ts");
    writeFileSync(extension, TOAST_EXTENSION);
    const page = await launch(gitProject("project"), { piArgs: ["-e", extension] });
    if (size === "minimum") await minimumSize(tondo!);
    const toasts = page.locator("[data-toast]");

    await send(page, "/tondo-toasts");
    await expect(toasts).toHaveCount(3);
    expect.soft(await toastsOver(page, "footer"), "toasts over the composer").toEqual([]);

    await send(page, "/tondo-long-select");
    const dialog = page.getByRole("dialog", { name: /^Which of these thirty/ });
    await expect(dialog).toBeVisible();
    await expect(toasts).toHaveCount(3);
    expect.soft(await toastsOver(page, "footer"), "toasts over the dialog").toEqual([]);
    await expect(page.getByRole("alert").filter({ hasText: "lint-on-save failed" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `toasts-dialog-${size}.png`) });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}
