// Settings > Accounts with the real pi, offline with the faux model: the
// sign-ins in pi's auth.json without their secrets, the Claude usage an
// extension shows, and pi's Anthropic sign-in menu, opened from Settings and
// from the composer.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { answerFolderDialog, launchWithPi, PI_START_TIMEOUT_MS, send, waitForPi } from "./pi";

test.describe.configure({ timeout: 90_000 });

const repoRoot = path.resolve(__dirname, "..");
const USAGE_EXTENSION = path.join(repoRoot, "scripts/fixtures/claude-usage-ext.ts");
const SCREENSHOTS = path.join(repoRoot, ".dev/signin/run2");
const USAGE = "🧠 5h 12% · wk 34%";

let workDir: string;
let tondo: Tondo;

test.beforeEach(async () => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-accounts-e2e-")));
  const profileDir = path.join(workDir, "profile");
  const project = path.join(workDir, "project");
  // Unpackaged Tondo gives pi <profile>/pi-agent as its agent folder.
  mkdirSync(path.join(profileDir, "pi-agent"), { recursive: true });
  mkdirSync(project);
  writeFileSync(
    path.join(profileDir, "pi-agent", "auth.json"),
    JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "synthetic-access",
        refresh: "synthetic-refresh",
        expires: 4102444800000,
      },
      openai: { type: "api_key", key: "sk-synthetic" },
    }),
  );
  tondo = await launchWithPi({
    workDir,
    profileDir,
    script: { responses: [] },
    piArgs: ["-e", USAGE_EXTENSION],
  });
  const { app, page } = tondo;
  await bringToFront(tondo);
  await answerFolderDialog(app, project);
  const addProject = page.getByRole("button", { name: "Add project", exact: true });
  await expect(addProject).toBeEnabled();
  // dispatchEvent clicks without moving the mouse, so no hover or tooltip shows in screenshots.
  await addProject.dispatchEvent("click");
  await waitForPi(page);
});

test.afterEach(async () => {
  await tondo.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("Accounts lists pi's sign-ins and Claude's usage, and never their secrets", async () => {
  const { page } = tondo;
  const secrets = await watchForText(page, "synthetic");
  const settings = await openAccounts(page);
  const anthropic = settings.getByRole("group", { name: "Anthropic", exact: true });
  await expect(anthropic).toContainText("Claude Pro/Max subscription");
  await expect(anthropic).toContainText(USAGE);
  await expect(settings.getByRole("group", { name: "OpenAI", exact: true })).toContainText(
    "API key",
  );
  await expect(settings).not.toContainText("no other saved sign-ins");

  // The title has focus from the shortcut, and its ring isn't part of the page's look.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await screenshotAccounts(page, "light");
  await screenshotAccounts(page, "dark");
  expect(await secrets.evaluate((seen) => seen.found)).toBe(false);
  expect(await page.content()).not.toContain("synthetic");
});

test("Sign in with Claude closes Settings and opens pi's Anthropic sign-in menu", async () => {
  const { page } = tondo;
  const settings = await openAccounts(page);
  await settings.getByRole("button", { name: "Sign in with Claude", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expectAnthropicMenu(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "sign-in-with-claude.png"),
    animations: "disabled",
  });
});

test("/login anthropic in the composer opens pi's Anthropic sign-in menu", async () => {
  const { page } = tondo;
  await send(page, "/login anthropic!");
  await expect(page.getByRole("status").filter({ hasText: '"/login anthropic"' })).toBeVisible();
  // Had that opened a sign-in terminal, this one would reuse it, and pi wouldn't get /login.
  await send(page, "/login anthropic");
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expectAnthropicMenu(page);
});

async function openAccounts(page: Page) {
  // Shortcuts do nothing until main has handed the page its port to the host.
  await expect(page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Accounts", exact: true })
    .dispatchEvent("click");
  await expect(settings.getByRole("heading", { level: 2, name: "Accounts" })).toBeVisible();
  return settings;
}

/** pi 0.87.1's menu for a provider with both an account and an API key sign-in. The test presses nothing in it. */
async function expectAnthropicMenu(page: Page): Promise<void> {
  // xterm's accessibility tree mirrors the viewport, not the scrollback.
  const visibleRows = () => page.locator(".xterm-accessibility-tree > div").allTextContents();
  await expect
    .poll(visibleRows, { timeout: PI_START_TIMEOUT_MS })
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining("Select authentication method for Anthropic:"),
        expect.stringContaining("→ Sign in with an account"),
        expect.stringContaining("Sign in with an API key"),
      ]),
    );
}

/** Whether the page's HTML has held `text` at any point from now on. */
function watchForText(page: Page, text: string) {
  return page.evaluateHandle((needle) => {
    const seen = { found: document.documentElement.outerHTML.includes(needle) };
    new MutationObserver(() => {
      if (document.documentElement.outerHTML.includes(needle)) seen.found = true;
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    return seen;
  }, text);
}

async function screenshotAccounts(page: Page, colorScheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme });
  await transitionsDone(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `accounts-${colorScheme}.png`),
    animations: "disabled",
  });
}

async function transitionsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    // A transition that another style change replaces is cancelled, which rejects `finished`.
    await Promise.allSettled(running.map((animation) => animation.finished));
  });
}
