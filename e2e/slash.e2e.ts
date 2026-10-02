// The slash menu: pi's extension commands, prompt templates and skills from
// get_commands, with pi's built-ins that Tondo runs its own way. No built-in
// reaches pi as text.
import { expect, test, type Page } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  PI_START_TIMEOUT_MS,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
} from "./pi";

test.describe.configure({ timeout: 90_000 });

const UI_EXTENSION = path.resolve(__dirname, "../scripts/fixtures/ui-ext.ts");

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-slash-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

/** The slash menu over the composer. */
function menu(page: Page) {
  return page.getByRole("listbox", { name: "Commands" });
}

/** The toast that says `text`. */
function toast(page: Page, text: string | RegExp) {
  return page.getByRole("status").filter({ hasText: text });
}

test("the slash menu lists an extension's command, a prompt template and a skill", async () => {
  const template = path.join(workDir, "tondo-hello.md");
  writeFileSync(template, "---\ndescription: Says hello to someone\n---\nSay hello to $1.\n");
  const skill = path.join(workDir, "tondo-skill");
  mkdirSync(skill);
  writeFileSync(
    path.join(skill, "SKILL.md"),
    "---\nname: tondo-skill\ndescription: A skill for Tondo's tests.\n---\nSay that the skill ran.\n",
  );
  tondo = await launchWithPi({
    workDir,
    script: { responses: [reply("Hello, world.")] },
    // pi loads a template or skill given by path even under --no-skills.
    piArgs: ["-e", UI_EXTENSION, "--prompt-template", template, "--skill", skill],
  });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);

  await composer(page).focus();
  await page.keyboard.type("/");
  const options = menu(page).getByRole("option");
  await expect(options.filter({ hasText: "/tondo-ui" })).toContainText("Extension");
  await expect(options.filter({ hasText: "/tondo-hello" })).toContainText("Says hello to someone");
  await expect(options.filter({ hasText: "/tondo-hello" })).toContainText("Prompt");
  await expect(options.filter({ hasText: "/skill:tondo-skill" })).toContainText("Skill");
  // pi's built-ins that Tondo runs come first, and the ones it can't run come last.
  await expect(options.first()).toContainText("/model");
  await expect(options.last()).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({ path: test.info().outputPath("menu.png"), animations: "disabled" });

  // Typing narrows the menu, Tab completes, and the template runs with its argument.
  await page.keyboard.type("tondo-h");
  await expect(options.first()).toContainText("/tondo-hello");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expectDraft(page, "/tondo-hello ");
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type("world");
  await page.keyboard.press("Enter");
  // pi expanded the template before the model saw it.
  await expect(page.getByTestId("timeline").getByText("Say hello to world.")).toBeVisible();
  await expect(page.getByText("Hello, world.")).toBeVisible();

  // Escape closes the menu without stopping anything, and the text stays.
  await page.keyboard.type("/ski");
  await expect(options.first()).toContainText("/skill:tondo-skill");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expectDraft(page, "/ski");
});

test("pi's built-in commands run in Tondo and never reach pi as text", async () => {
  tondo = await launchWithPi({
    workDir,
    script: { responses: [reply("First reply.")] },
  });
  const { app, page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Hi.");
  await expect(page.getByText("First reply.")).toBeVisible();
  await waitForIdle(page);

  await send(page, "/copy");
  await expect(toast(page, "Copied pi's last reply.")).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("First reply.");
  await expectDraft(page, "");

  await send(page, "/session");
  const session = page.getByRole("dialog", { name: "Session" });
  const row = (term: string) =>
    session.locator("dt", { hasText: new RegExp(`^${term}$`) }).locator("+ dd");
  await expect(row("File")).toContainText(/\.jsonl/);
  await expect(row("Yours")).toHaveText("1");
  await expect(row("pi's")).toHaveText("1");
  await session.screenshot({ path: test.info().outputPath("session.png") });
  await page.keyboard.press("Escape");
  await expect(session).toBeHidden();

  await send(page, "/name Better name");
  await expect(threadRows(page).first()).toHaveAttribute("title", "Better name");

  await send(page, "/thinking high");
  await expect(page.getByLabel("Thinking level")).toHaveValue("high");
  await send(page, "/thinking loud");
  await expect(toast(page, 'Unknown thinking level "loud".')).toBeVisible();
  await send(page, "/model faux/faux-2");
  await expect(page.getByLabel("Model")).toHaveValue("faux/faux-2");

  // /export saves HTML and offers the file in Finder.
  await app.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { tondoRevealed?: string[] };
    state.tondoRevealed = [];
    shell.showItemInFolder = (file) => state.tondoRevealed!.push(file);
  });
  await send(page, "/export");
  const saved = toast(page, /^Saved the thread to /);
  await expect(saved).toBeVisible();
  const file = /Saved the thread to (.+\.html)\./.exec((await saved.textContent()) ?? "")?.[1];
  expect(file && path.dirname(file)).toBe(project);
  expect(existsSync(file!)).toBe(true);
  await saved.getByRole("button", { name: /^Show in / }).click();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as { tondoRevealed?: string[] }).tondoRevealed ?? []),
    )
    .toEqual([file]);

  // Commands Tondo can't run say why.
  await send(page, "/login");
  await expect(toast(page, "Tondo can't sign in to providers yet.")).toBeVisible();
  // pi fails to compact so short a thread, and the thread says so once.
  await send(page, "/compact");
  await expect(page.getByRole("alert")).toContainText(
    "Compaction failed: Nothing to compact (session too small)",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);

  await send(page, "/hotkeys");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Alt+Enter");
  await page.keyboard.press("Escape");
  await send(page, "/settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toContainText(path.join(project, ".pi", "settings.json"));
  await page.keyboard.press("Escape");
  await send(page, "/trust");
  await expect(page.getByRole("dialog", { name: "Project trust" })).toContainText(
    "nothing for pi to trust",
  );
  await page.keyboard.press("Escape");

  // Long after /compact failed, it still said so only once.
  await expect(page.getByRole("alert")).toHaveCount(1);

  // /reload starts pi again on the session, which holds only what went to the
  // model: no built-in reached pi as a prompt.
  await send(page, "/reload");
  await expect(composer(page)).toHaveAttribute("aria-placeholder", "Starting pi…");
  await waitForPi(page);
  await expect(page.getByLabel("Model")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await expect(page.locator("[data-index]")).toHaveCount(2);
  await expect(page.getByTestId("timeline")).not.toContainText("/");

  await send(page, "/resume");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await send(page, "/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
});

test("/trust changes your answer, and pi starts again with it", async () => {
  // pi asks about a project with its own .pi settings, and applies them only
  // in a project it trusts, so the thinking level shows what pi was told.
  mkdirSync(path.join(project, ".pi"));
  writeFileSync(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({ defaultThinkingLevel: "low" }),
  );
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await page.getByRole("button", { name: "Trust", exact: true }).click();
  await waitForPi(page);
  const thinking = page.getByLabel("Thinking level");
  await expect(thinking).toHaveValue("low");

  await send(page, "/trust");
  const sheet = page.getByRole("dialog", { name: "Project trust" });
  await expect(sheet).toContainText("You told Tondo to trust this project.");
  await sheet.getByRole("button", { name: "Don't trust" }).click();
  await expect(sheet).toBeHidden();
  await expect(composer(page)).toHaveAttribute("aria-placeholder", "Starting pi…");
  await waitForPi(page);
  // The new pi skipped the project's settings, so it's back at pi's default.
  await expect(thinking).toHaveValue("medium");
  const settings = JSON.parse(readFileSync(path.join(tondo.profileDir, "settings.json"), "utf8"));
  expect(settings.projectTrust).toEqual({ [project]: false });
});
