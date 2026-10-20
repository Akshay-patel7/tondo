// Keyboard paths and screen-reader names, with the real pi offline. The walk
// drives a whole thread with the keyboard alone and saves a screenshot of the
// focus ring at each step to test-results/keyboard/. The audit reads
// Chromium's accessibility tree in each state and lists every control
// without a name.
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
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  answerFolderDialog,
  bashCall,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  THREAD_ROW,
  threads,
  waitForIdle,
  waitForPi,
  words,
} from "./pi";
import { pickOption } from "./ui";

test.describe.configure({ timeout: 120_000 });

const SHOTS = path.resolve(__dirname, "../test-results/keyboard");
const PROJECT = "kbproject";

let dir: string;
let project: string;
let env: Record<string, string>;
let tondo: Tondo | undefined;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: project, env, encoding: "utf8", stdio: "pipe" }).trim();

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-keyboard-e2e-")));
  project = path.join(dir, PROJECT);
  mkdirSync(project);
  env = {
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, "README.md"), "Initial\n");
  git("add", ".");
  git("commit", "-m", "initial");
  git("branch", "feature");
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

async function launch(responses: Parameters<typeof launchWithPi>[0]["script"]["responses"]) {
  tondo = await launchWithPi({ workDir: dir, env, script: { responses } });
  // The page applies pi's events once a frame, and a window you can't see gets no frames.
  await bringToFront(tondo);
  // Playwright emulates a light scheme unless told not to, which would hide the theme Tondo sets.
  await tondo.page.emulateMedia({ colorScheme: null });
  // Shortcuts do nothing until main has handed the page its port to the host.
  await expect(tondo.page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();
  return tondo;
}

test("keyboard alone reaches every part of a thread", async () => {
  const { app, page } = await launch([reply(words(3000))]);
  const transcript = page.getByRole("region", { name: "Transcript", exact: true });
  const changes = page.getByRole("button", { name: "Changes", exact: true });
  const row = threads(page).locator(THREAD_ROW).first();
  const header = threads(page).getByRole("button", { name: PROJECT, exact: true });

  await test.step("the palette adds a project", async () => {
    // The folder dialog is the OS's, so main answers it.
    await answerFolderDialog(app, project);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expectFocused(page, palette.getByRole("combobox", { name: "Search" }));
    await page.keyboard.type("Add project");
    await expect(palette.getByRole("option", { selected: true })).toContainText("Add project");
    await shot(page, "01-palette-add-project");
    await page.keyboard.press("Enter");
    await expect(palette).not.toBeAttached();
  });

  await test.step("a new thread opens, pi starts, and the composer sends", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
    await waitForPi(page);
    expect(await reach(page, composer(page), "Shift+Tab"), "Tab reaches the composer").toBe(true);
    await expectComposerFocused(page);
    await page.keyboard.type("Tell me a long story.");
    await shot(page, "02-composer");
    await page.keyboard.press("Enter");
    await expect(message(page, 1)).toContainText("word2999");
    await waitForIdle(page);
  });

  await test.step("the transcript scrolls, and Jump to latest focuses it", async () => {
    expect(await reach(page, transcript, "Shift+Tab"), "Tab reaches the transcript").toBe(true);
    await expectFocusRing(page);
    await shot(page, "03-transcript");
    const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
    await page.keyboard.press("PageUp");
    await expect(jump).toBeVisible();
    await expectFocused(page, transcript);
    await page.keyboard.press("Tab");
    await expectFocused(page, jump);
    await shot(page, "04-jump-to-latest");
    await page.keyboard.press("Enter");
    await expectFocused(page, transcript);
    await expect(jump).toBeHidden();
    // The jump scrolls after it hides the button. A PageUp before that scroll lands would be undone.
    await expect
      .poll(() =>
        transcript.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight),
      )
      .toBeLessThan(2);
    await page.keyboard.press("PageUp");
    await expect(jump).toBeVisible();
    await page.keyboard.press("End");
    await expect(jump).toBeHidden();
    await expectFocused(page, transcript);
  });

  await test.step("Changes opens the diff panel, and Escape closes it", async () => {
    expect(await reach(page, changes, "Shift+Tab"), "Tab reaches Changes").toBe(true);
    await expectFocusRing(page);
    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "Turn changes" });
    await expect(panel).toBeVisible();
    await expect(changes).toHaveAttribute("aria-pressed", "true");
    await expectFocused(page, changes);
    await shot(page, "05-changes-open");
    const close = panel.getByRole("button", { name: "Close changes" });
    expect(await reach(page, close, "Tab"), "Tab reaches the diff panel").toBe(true);
    await expectFocusRing(page);
    await shot(page, "06-diff-panel");
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeAttached();
    await expectFocused(page, changes);
  });

  await test.step("the git menu opens from the keyboard and the arrow keys move through it", async () => {
    const chevron = page.getByRole("button", { name: "Git actions", exact: true });
    expect(await reach(page, chevron, "Tab"), "Tab reaches the git menu").toBe(true);
    await expectFocusRing(page);
    await shot(page, "07-git-actions");
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const newBranch = menu.getByRole("menuitem", { name: "New branch", exact: true });
    const newWorktree = menu.getByRole("menuitem", { name: "New worktree", exact: true });
    const refresh = menu.getByRole("menuitem", { name: "Refresh", exact: true });
    // The popup is visible before its opening focus transfer finishes.
    await expectFocused(
      page,
      menu.locator('[role="menuitem"]:not([aria-disabled="true"])').first(),
    );
    await page.keyboard.press("End");
    await expectFocused(page, refresh);
    await shot(page, "08-git-menu-end");
    await page.keyboard.press("ArrowUp");
    await expectFocused(page, newWorktree);
    await page.keyboard.press("ArrowUp");
    await expectFocused(page, newBranch);
    await page.keyboard.press("ArrowDown");
    await expectFocused(page, newWorktree);
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeAttached();
    await expectFocused(page, chevron);
  });

  await test.step("the sidebar list moves by arrows and opens menus", async () => {
    expect(await reach(page, row, "Shift+Tab"), "Shift+Tab reaches the thread list").toBe(true);
    await expectFocusRing(page);
    await shot(page, "09-sidebar-row");
    await page.keyboard.press("ArrowUp");
    await expectFocused(page, header);
    await page.keyboard.press("ArrowDown");
    await expectFocused(page, row);
    await page.keyboard.press("Home");
    await expectFocused(page, header);
    await page.keyboard.press("End");
    await expectFocused(page, row);

    // The project's own buttons follow its header.
    await page.keyboard.press("Home");
    await expectFocused(page, header);
    const projectActions = threads(page).getByRole("button", { name: "Project actions" });
    expect(await reach(page, projectActions, "Tab", 3), "Tab reaches Project actions").toBe(true);
    await expectFocusRing(page);
    await page.keyboard.press("Enter");
    const projectMenu = page.getByRole("menu", { name: "Project actions" });
    await expectFocused(page, projectMenu.getByRole("menuitem").first());
    await shot(page, "10-project-actions");
    await page.keyboard.press("Escape");
    await expect(projectMenu).not.toBeAttached();
    await expectFocused(page, projectActions);
    expect(await reach(page, header, "Shift+Tab", 3), "Shift+Tab returns to the header").toBe(true);
    await expectFocusRing(page);
    await page.keyboard.press("Shift+F10");
    const headerMenu = page.getByRole("menu", { name: `${PROJECT} actions` });
    await expectFocused(page, headerMenu.getByRole("menuitem").first());
    await page.keyboard.press("Escape");
    await expect(headerMenu).not.toBeAttached();
    await expectFocused(page, header);

    await page.keyboard.press("ArrowDown");
    await expectFocused(page, row);
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-current", "page");
    await expectFocused(page, row);
    await page.keyboard.press("Shift+F10");
    const threadMenu = page.getByRole("menu", { name: "Thread actions" });
    await expectFocused(page, threadMenu.getByRole("menuitem").first());
    await shot(page, "11-thread-actions");
    await page.keyboard.press("Escape");
    await expect(threadMenu).not.toBeAttached();
    await expectFocused(page, row);
  });

  await test.step("Settings opens by shortcut, the arrows pick Dark, and Escape goes back", async () => {
    await page.keyboard.press("ControlOrMeta+Comma");
    const settings = page.getByRole("region", { name: "Settings", exact: true });
    await expectFocused(page, settings.getByRole("heading", { level: 2 }));
    await shot(page, "12-settings");
    const theme = settings.getByRole("group", { name: "Theme", exact: true });
    const pressed = theme.locator('[aria-pressed="true"]');
    expect(await reach(page, pressed, "Tab", 10), "Tab reaches the theme").toBe(true);
    await expectFocusRing(page);
    const dark = theme.getByRole("button", { name: "Dark", exact: true });
    // The theme has three choices, and the arrows wrap, so Dark is at most two presses away.
    expect(await reach(page, dark, "ArrowRight", 2), "the arrows reach Dark").toBe(true);
    await expectFocusRing(page);
    await page.keyboard.press("Enter");
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => prefersDark(page)).toBe(true);
    await expectFocused(page, dark);
    await shot(page, "13-settings-dark");
    await page.keyboard.press("Escape");
    await expect(settings).not.toBeAttached();
    await expectFocused(page, row);
  });

  await test.step("the palette opens the terminal, which runs a command and closes by Tab", async () => {
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expectFocused(page, palette.getByRole("combobox", { name: "Search" }));
    await page.keyboard.type("Terminal");
    await expect(palette.getByRole("option", { selected: true })).toContainText("Open terminal");
    await shot(page, "14-palette-terminal");
    await page.keyboard.press("Enter");
    await expect(palette).not.toBeAttached();
    const drawer = page.getByRole("region", { name: "Terminal", exact: true });
    await expectTerminalFocused(drawer);
    await page.keyboard.type("echo kb");
    await page.keyboard.press("Enter");
    await expect(
      drawer
        .locator(".xterm-accessibility-tree div")
        .filter({ hasText: /^\s*kb\s*$/ })
        .first(),
    ).toBeAttached();
    await shot(page, "15-terminal");

    const close = drawer.getByRole("button", { name: "Close terminal" });
    expect(await reach(page, close, "Shift+Tab", 4), "Shift+Tab leaves the terminal").toBe(true);
    await expectFocusRing(page);
    await shot(page, "16-close-terminal");
    const sharing = drawer.getByRole("switch", { name: "Share terminal output with chat" });
    await page.keyboard.press("Shift+Tab");
    await expectFocused(page, sharing);
    await shot(page, "17-share-with-chat");
    const separator = drawer.getByRole("separator", { name: "Resize terminal" });
    await page.keyboard.press("Shift+Tab");
    await expectFocused(page, separator);
    await expect
      .poll(() => separator.locator("span").evaluate((grip) => getComputedStyle(grip).opacity))
      .toBe("1");
    await shot(page, "18-resize-separator");
    await page.keyboard.press("Tab");
    await expectFocused(page, sharing);
    await page.keyboard.press("Tab");
    await expectFocused(page, close);
    await page.keyboard.press("Enter");
    await expect(drawer).not.toBeAttached();
  });
});

test("PageUp, PageDown and End do not leave a scroll animation running after a jump", async () => {
  const { page } = await launch([reply(words(3000))]);
  // Exercise the compositor/main-thread race seen on slower CI runners.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await addProject(tondo!, project);
  await waitForPi(page);
  await send(page, "Tell me a long story.");
  await expect(message(page, 1)).toContainText("word2999");
  await waitForIdle(page);
  const transcript = page.getByRole("region", { name: "Transcript", exact: true });
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await transcript.focus();
  /* oxlint-disable eslint/no-await-in-loop -- each jump must complete before the next gesture. */
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press("PageUp");
    await expect(jump).toBeVisible();
    await page.keyboard.press("End");
    await expect
      .poll(() =>
        transcript.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight),
      )
      .toBeLessThan(2);
    await expect(jump).toBeHidden();
  }
  /* oxlint-enable eslint/no-await-in-loop */
  await page.keyboard.press("Home");
  await expect.poll(() => transcript.evaluate((list) => list.scrollTop)).toBe(0);
  await page.keyboard.press("PageDown");
  await expect.poll(() => transcript.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(transcript).toBeFocused();
  await expect
    .poll(() =>
      transcript.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight),
    )
    .toBeLessThan(2);
  await expect(jump).toBeHidden();
  await shot(page, "scroll-jump-settled");
});

test("every control has an accessible name", async () => {
  const { page } = await launch([bashCall("echo audit > audit.txt"), reply("Done.")]);
  const audit = async (state: string) => {
    const { checked, unnamed } = await auditNames(page);
    expect.soft(checked, `controls the audit read: ${state}`).toBeGreaterThan(0);
    expect.soft(unnamed, `controls without a name: ${state}`).toEqual([]);
  };

  await audit("first launch");

  await addProject(tondo!, project);
  await waitForPi(page);
  await send(page, "Write a file.");
  await expect(page.getByRole("article", { name: "pi" }).getByText("Done.")).toBeVisible();
  await waitForIdle(page);
  const card = page.locator("[data-tool-call]").first();
  const cardHeader = card.locator("> button");
  await cardHeader.click();
  await expect(cardHeader).toHaveAttribute("aria-expanded", "true");
  const body = await cardHeader.getAttribute("aria-controls");
  expect(body, "an open tool card's header names its body").toBeTruthy();
  await expect(page.locator(`[id="${body}"]`)).toBeVisible();
  await audit("a thread with a reply and an expanded tool card");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("combobox", { name: "Search" })).toBeFocused();
  await audit("the palette open");
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeAttached();

  const row = threads(page).locator(THREAD_ROW).first();
  await row.click({ button: "right" });
  const threadMenu = page.getByRole("menu", { name: "Thread actions" });
  await expect(threadMenu).toBeVisible();
  await audit("a thread's menu open");
  await page.keyboard.press("Escape");
  await expect(threadMenu).not.toBeAttached();
  // The project's buttons show while you point at its header.
  await threads(page).getByRole("button", { name: PROJECT, exact: true }).hover();
  await threads(page).getByRole("button", { name: "Project actions" }).click();
  const projectMenu = page.getByRole("menu", { name: "Project actions" });
  await expect(projectMenu).toBeVisible();
  await audit("a project's menu open");
  await page.keyboard.press("Escape");
  await expect(projectMenu).not.toBeAttached();

  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { level: 2 })).toBeFocused();
  for (const name of ["Appearance", "pi", "Threads", "Shortcuts"]) {
    const button = settings
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name, exact: true });
    // oxlint-disable-next-line eslint/no-await-in-loop -- each section replaces the one before.
    await button.click();
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await expect(button).toHaveAttribute("aria-current", "page");
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await expect(settings.getByText("Loading settings…")).toHaveCount(0);
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await audit(`the Settings page, ${name}`);
  }
  await page.locator("header").getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).not.toBeAttached();

  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Turn changes" });
  await expect(panel.getByRole("button", { name: "Show diff for audit.txt" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Diff", exact: true })).toBeAttached();
  await audit("the diff panel");
  await panel.getByRole("button", { name: "Close changes" }).click();
  await expect(panel).not.toBeAttached();

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
  await audit("the terminal drawer");
  await drawer.getByRole("button", { name: "Close terminal" }).click();
  await expect(drawer).not.toBeAttached();

  await gitAction(page, "New branch");
  const createBranch = page.getByRole("dialog", { name: "Create branch" });
  await expect(createBranch).toBeVisible();
  await audit("the Create branch dialog");
  await page.keyboard.press("Escape");
  await expect(createBranch).not.toBeAttached();

  await gitAction(page, "Switch branch");
  const switchBranch = page.getByRole("alertdialog", { name: "Switch branch" });
  await expect(switchBranch).toBeVisible();
  await pickOption(switchBranch, "Git branch", "feature");
  await expect(page.getByRole("dialog", { name: "Switch branch" })).toHaveCount(0);
  await audit("the Switch branch alert dialog");
  await switchBranch.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(switchBranch).not.toBeAttached();

  await gitAction(page, "New worktree");
  const createWorktree = page.getByRole("dialog", { name: "Create worktree thread" });
  await createWorktree.getByRole("textbox", { name: "Branch name" }).fill("kb-worktree");
  await createWorktree.getByRole("button", { name: "Create worktree thread", exact: true }).click();
  await expect(createWorktree).not.toBeAttached();
  await waitForPi(page);
  await gitAction(page, "Remove worktree");
  const removeWorktree = page.getByRole("alertdialog", {
    name: "Remove worktree",
  });
  await expect(removeWorktree).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Remove worktree" })).toHaveCount(0);
  await audit("the Remove worktree alert dialog");
  await removeWorktree.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(removeWorktree).not.toBeAttached();
});

/** Chooses the Git action named `name` in the menu behind the header's Commit & push chevron. */
async function gitAction(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Git actions", exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name, exact: true }).click();
  await expect(menu).toBeHidden();
}

/**
 * Presses `key` until `target` has focus, at most `presses` times. It returns
 * whether focus got there, so a test can tell a missing keyboard path from a
 * slow one.
 */
async function reach(page: Page, target: Locator, key: string, presses = 40): Promise<boolean> {
  for (let press = 0; ; press++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each press depends on where the last one left focus.
    if (await isFocused(target)) return true;
    if (press === presses) return false;
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await page.keyboard.press(key);
  }
}

/** Whether `target` has focus. Unlike evaluate, it doesn't wait for a missing element. */
function isFocused(target: Locator): Promise<boolean> {
  return target.evaluateAll((elements) =>
    elements.some((element) => element === document.activeElement),
  );
}

/** Asserts that `target` has focus and shows it. */
async function expectFocused(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await expectFocusRing(page);
}

/**
 * Asserts that the focused element matches :focus-visible and draws a focus
 * indicator: an outline, a box-shadow ring, or, for a highlighted menu item or
 * option, a filled background, which is how menus mark the item the arrows
 * reached.
 */
async function expectFocusRing(page: Page): Promise<void> {
  await expect.poll(() => focusIndicator(page)).toBe("visible");
}

/** "visible", or why the focused element shows no focus indicator. */
function focusIndicator(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "focus is on the page";
    const name = `<${active.tagName.toLowerCase()}> "${active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 40) ?? ""}"`;
    if (!active.matches(":focus-visible")) return `${name} doesn't match :focus-visible`;
    // Colors serialize as rgb(), oklch() and the like, with a zero alpha when transparent.
    const clear = /^transparent$|[,/]\s*0\)$/;
    const style = getComputedStyle(active);
    if (
      style.outlineStyle !== "none" &&
      parseFloat(style.outlineWidth) > 0 &&
      !clear.test(style.outlineColor)
    ) {
      return "visible";
    }
    // A ring is a box shadow with a spread: "<color> <x> <y> <blur> <spread> [inset]".
    const shadow =
      /((?:[a-z-]+\([^)]*\))|#[\da-f]+|[a-z]+)\s+-?[\d.]+px\s+-?[\d.]+px\s+[\d.]+px\s+(-?[\d.]+)px/gi;
    for (const [, color, spread] of style.boxShadow.matchAll(shadow)) {
      if (Number(spread) > 0 && !clear.test(color!)) return "visible";
    }
    const highlighted = active.matches(
      '[role="menuitem"][data-highlighted], [role="option"][data-highlighted]',
    );
    if (highlighted && !clear.test(style.backgroundColor)) return "visible";
    return `${name} has no outline, ring or highlight (outline ${style.outline}, box-shadow ${style.boxShadow})`;
  });
}

/**
 * The composer's editor is a contenteditable inside a card, and the card shows
 * focus instead, with a border in the ring color.
 */
async function expectComposerFocused(page: Page): Promise<void> {
  await expect(composer(page)).toBeFocused();
  await expect
    .poll(() =>
      composer(page).evaluate((editor) => {
        const probe = document.createElement("div");
        probe.style.color = "var(--ring)";
        document.body.append(probe);
        const ring = getComputedStyle(probe).color;
        probe.remove();
        for (let card = editor.parentElement; card; card = card.parentElement) {
          const style = getComputedStyle(card);
          if (parseFloat(style.borderTopWidth) > 0 && style.borderTopColor === ring) return true;
        }
        return false;
      }),
    )
    .toBe(true);
}

/**
 * xterm takes keys through a hidden textarea and shows focus on the terminal
 * instead: its .focus class draws the focused, filled cursor.
 */
async function expectTerminalFocused(drawer: Locator): Promise<void> {
  await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
  await expect(drawer.locator(".xterm")).toHaveClass(/(^|\s)focus(\s|$)/);
}

/** Saves the window as test-results/keyboard/<name>.png. */
async function shot(page: Page, name: string): Promise<void> {
  // Finish transitions first, or a toggle's 150 ms color change shows its old state.
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

function prefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
}

/** The timeline's row at `index`, counting from the first message. */
function message(page: Page, index: number) {
  return page.locator(`[data-index="${index}"]`);
}

/** The roles a screen reader announces by name, which Chromium reports in its accessibility tree. */
const NAMED_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "menuitem",
  "option",
  "checkbox",
  "switch",
  "tab",
  "slider",
  "spinbutton",
  "searchbox",
]);

/**
 * How many controls the page's accessibility tree holds, and those whose
 * computed name is empty, each as its role and HTML.
 */
async function auditNames(page: Page): Promise<{ checked: number; unnamed: string[] }> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Accessibility.enable");
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const controls = nodes.filter(
      (node) => !node.ignored && NAMED_ROLES.has(String(node.role?.value ?? "")),
    );
    const nameless = controls.filter((node) => String(node.name?.value ?? "").trim() === "");
    const unnamed = await Promise.all(
      nameless.map(async (node) => {
        const role = String(node.role?.value);
        if (node.backendDOMNodeId === undefined) return role;
        const { object } = await cdp.send("DOM.resolveNode", {
          backendNodeId: node.backendDOMNodeId,
        });
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId!,
          functionDeclaration: "function () { return this.outerHTML.slice(0, 240); }",
          returnByValue: true,
        });
        return `${role}: ${String(result.value)}`;
      }),
    );
    return { checked: controls.length, unnamed };
  } finally {
    await cdp.detach();
  }
}

test("closing Settings gives focus back to the composer that opened it", async () => {
  const { page } = await launch([]);
  await addProject(tondo!, project);
  await waitForPi(page);
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  const title = settings.getByRole("heading", { level: 2 });

  await composer(page).focus();
  await page.keyboard.press("ControlOrMeta+Comma");
  await expectFocused(page, title);
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeAttached();
  await expectComposerFocused(page);

  await page.keyboard.press("ControlOrMeta+Comma");
  await expectFocused(page, title);
  await page.locator("header").getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).not.toBeAttached();
  await expectComposerFocused(page);
});

test("Shift+Tab reaches the open thread's actions on the way back, as Tab does on the way out", async () => {
  const { page } = await launch([]);
  await addProject(tondo!, project);
  await waitForPi(page);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Keyboard draft");
  const row = threads(page).locator(THREAD_ROW).first();
  await expect(row).toBeVisible();
  const actions = threads(page).getByRole("button", { name: "Thread actions" });
  // The sidebar's footer follows the list, so its Settings button is the next stop out.
  const next = threads(page).getByRole("button", { name: "Settings", exact: true });

  await next.focus();
  await page.keyboard.press("Shift+Tab");
  await expectFocused(page, actions);
  // Focus in the row shows the button, which fades out at rest.
  await expect
    .poll(() => actions.evaluate((button) => getComputedStyle(button.parentElement!).opacity))
    .toBe("1");
  await page.keyboard.press("Shift+Tab");
  await expectFocused(page, row);
  await page.keyboard.press("Tab");
  await expectFocused(page, actions);
  await page.keyboard.press("Tab");
  await expectFocused(page, next);
});

test("each picker's open list has the picker's name", async () => {
  const { page } = await launch([]);
  await addProject(tondo!, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Turn changes" })).toBeVisible();
  await expectListNamed(page, "Model");
  await expectListNamed(page, "Thinking level");
  await expectListNamed(page, "Checkpoint turn");
  // The branch picker lives in the Switch branch dialog.
  await gitAction(page, "Switch branch");
  const switchBranch = page.getByRole("alertdialog", { name: "Switch branch" });
  await expect(switchBranch).toBeVisible();
  await expectListNamed(page, "Git branch");
  await switchBranch.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(switchBranch).not.toBeAttached();
});

/** Opens the picker named `picker`, expects its list to take the same name, and closes it. */
async function expectListNamed(page: Page, picker: string): Promise<void> {
  await page.getByRole("combobox", { name: picker, exact: true }).click();
  const list = page.getByRole("listbox", { name: picker, exact: true });
  await expect(list).toBeVisible();
  // Visibility precedes the opening focus transfer. Escape sent to the old
  // focus can close the parent dialog instead of the picker's popup.
  await expect
    .poll(() =>
      list.evaluate((element) =>
        element
          .closest('[data-slot="select-content"], [data-slot="combobox-content"]')
          ?.contains(document.activeElement),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
}

/** Opens Settings with its shortcut and goes to the Shortcuts section. */
async function openShortcuts(page: Page): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { level: 2 })).toBeFocused();
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts", exact: true })
    .click();
  await expect(settings.getByText("Loading settings…")).toHaveCount(0);
  return settings;
}

test("a shortcut without mod in settings.json is off and flagged, and its key types", async () => {
  tondo = await launchWithPi({
    workDir: dir,
    env,
    script: { responses: [] },
    settings: { shortcuts: { palette: "k" } },
  });
  await bringToFront(tondo);
  const { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);

  await composer(page).click();
  await page.keyboard.type("kick");
  await expectDraft(page, "kick");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  const settings = await openShortcuts(page);
  await expect(
    settings.getByRole("group", { name: "Search", exact: true }).getByRole("alert"),
  ).toHaveText("Command palette's shortcut k needs mod, which is Cmd or Ctrl.");
});

test("two commands on one chord in settings.json are flagged, and a change to a third saves", async () => {
  tondo = await launchTondo({ env, settings: { shortcuts: { palette: "mod+n" } } });
  const { page, profileDir } = tondo;
  // Shortcuts do nothing until main has handed the page its port to the host.
  await expect(page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();

  const settings = await openShortcuts(page);
  const clash = "New thread and Command palette both use mod+n.";
  const flag = (name: string) =>
    settings.getByRole("group", { name, exact: true }).getByRole("alert");
  await expect(flag("Search")).toHaveText(clash);
  await expect(flag("New thread")).toHaveText(clash);

  const row = settings.getByRole("group", { name: "Settings", exact: true });
  await row.getByRole("button", { name: /^Change shortcut, / }).click();
  await expect(row.getByRole("textbox", { name: "Shortcut for Settings" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(row.getByRole("button", { name: /^Change shortcut, / })).toBeFocused();
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      () =>
        (
          JSON.parse(readFileSync(path.join(profileDir, "settings.json"), "utf8")) as {
            shortcuts?: unknown;
          }
        ).shortcuts,
    )
    .toEqual({ palette: "mod+n", settings: "mod+j" });
});
