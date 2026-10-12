// Settings > Accounts with the real pi, offline with the faux model: the
// sign-ins in pi's auth.json without their secrets, the Claude usage an
// extension shows, pi's Anthropic sign-in menu, opened from Settings and from
// the composer, and sign-in for any provider, which Accounts keeps while the
// header, with pi signed in, offers none.
import { expect, test, type JSHandle, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { answerFolderDialog, launchWithPi, PI_START_TIMEOUT_MS, send, waitForPi } from "./pi";

test.describe.configure({ timeout: 90_000 });

const repoRoot = path.resolve(__dirname, "..");
const USAGE_EXTENSION = path.join(repoRoot, "scripts/fixtures/claude-usage-ext.ts");
const SCREENSHOTS = path.join(repoRoot, ".dev/improvements-20261011/qa/accounts");
const USAGE = "🧠 5h 12% · wk 34%";

let workDir: string;
let tondo: Tondo;
/** Whether the header offered sign-in at any point since before the project's pi started. */
let headerOffers: JSHandle<{ found: boolean }>;

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
  headerOffers = await watchHeaderForSignIn(page);
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
  await expect(
    settings.getByRole("button", { name: "Sign in to a provider", exact: true }),
  ).toBeEnabled();

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

test("with sign-ins saved and pi signed in, the header never offers sign-in", async () => {
  const { page } = tondo;
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign in to a provider" })).toHaveCount(0);
  // Not even while pi started, before it had said which models you can use.
  expect(await headerOffers.evaluate((seen) => seen.found)).toBe(false);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "header-signed-in.png"),
    animations: "disabled",
  });
});

test("Sign in to a provider closes Settings and opens pi's sign-in for any provider", async () => {
  const { page } = tondo;
  const settings = await openAccounts(page);
  // Beside Claude's own sign-in, which stays.
  await expect(
    settings.getByRole("button", { name: "Sign in with Claude", exact: true }),
  ).toBeEnabled();
  await settings
    .getByRole("group", { name: "Other providers", exact: true })
    .getByRole("button", { name: "Sign in to a provider", exact: true })
    .click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  // Tondo names no provider, so pi starts on its own prompt, where /login asks
  // how to sign in before it lists every provider.
  const terminal = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(terminal.locator(".xterm-accessibility-tree")).toContainText("faux", {
    timeout: PI_START_TIMEOUT_MS,
  });
  const input = terminal.locator(".xterm-helper-textarea");
  await input.focus();
  await input.pressSequentially("/login");
  await input.press("Enter");
  await expectAnyProviderMenu(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "sign-in-to-a-provider.png"),
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
  // The page's title is in the header, so focus starts on the section's heading.
  await expect(settings.getByRole("heading", { level: 2 })).toBeFocused();
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

/** pi 0.87.1's /login menu with no provider named, before it lists them. The test presses nothing in it. */
async function expectAnyProviderMenu(page: Page): Promise<void> {
  // xterm's accessibility tree mirrors the viewport, not the scrollback.
  const visibleRows = () => page.locator(".xterm-accessibility-tree > div").allTextContents();
  await expect
    .poll(visibleRows, { timeout: PI_START_TIMEOUT_MS })
    .toEqual(expect.arrayContaining([expect.stringContaining("Select authentication method:")]));
}

/** Whether the header has offered sign-in at any point from now on, even too briefly to poll for. */
function watchHeaderForSignIn(page: Page) {
  return page.evaluateHandle((label) => {
    const offers = (node: Node | null) =>
      node instanceof Element &&
      [node, ...node.querySelectorAll("button")].some(
        (element) => element.tagName === "BUTTON" && element.textContent?.startsWith(label),
      );
    const seen = { found: offers(document.querySelector("header")) };
    new MutationObserver((records) => {
      // A button the header gained counts even if a change in the same batch took it away.
      const added = records.flatMap((record) =>
        record.target instanceof Element && record.target.closest("header")
          ? [...record.addedNodes]
          : [],
      );
      if (offers(document.querySelector("header")) || added.some(offers)) seen.found = true;
    }).observe(document.body, { subtree: true, childList: true });
    return seen;
  }, "Sign in");
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
