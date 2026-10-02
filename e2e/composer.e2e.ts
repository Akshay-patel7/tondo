import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
} from "./pi";

let workDir: string;
let project: string;
let tondo: Tondo | undefined;
let errors: string[];

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-composer-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
  errors = [];
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

function recordErrors(page: Page): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

async function start(): Promise<Page> {
  tondo = await launchWithPi({
    workDir,
    script: { responses: [reply("First reply."), reply("Second reply.")] },
  });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  return tondo.page;
}

test("IME Enter does not send or split, and Shift+Enter adds one literal newline", async () => {
  const page = await start();
  await composer(page).fill("你好");
  // CDP cannot open an OS input method. Exercise the browser event guard,
  // including an IME's final Enter whose keyCode is 229 after compositionend.
  await composer(page).dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expectDraft(page, "你好");
  await expect(page.locator("[data-index]")).toHaveCount(0);
  await composer(page).dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
  await expectDraft(page, "你好");
  await expect(page.locator("[data-index]")).toHaveCount(0);
  await composer(page).press("Shift+Enter");
  await page.keyboard.type("**literal**");
  await expectDraft(page, "你好\n**literal**");
  await composer(page).press("Enter");
  await expect(page.getByText("First reply.", { exact: true })).toBeVisible();
  expect(await page.locator('[data-index="0"]').textContent()).toBe("你好\n**literal**");
  await expectDraft(page, "");
});

test("Markdown paste and copy preserve source and empty lines without importing HTML", async () => {
  const page = await start();
  const source =
    '# Heading\n\n**bold** and @"space name.txt"\n```ts\n  const x = "<img src=x>";\n```\n';
  await tondo!.app.evaluate(
    ({ clipboard, ClipboardItem }, text) =>
      clipboard.write([
        new ClipboardItem({
          "text/plain": text,
          "text/html": "<h1>Wrong clipboard format</h1><script>throw Error('paste')</script>",
        }),
      ]),
    source,
  );
  await composer(page).focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expectDraft(page, source);
  await expect(composer(page).locator("h1, strong, img, script")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  expect(await tondo!.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source);
  await page.keyboard.press("ControlOrMeta+x");
  await expectDraft(page, "");
  await page.keyboard.press("ControlOrMeta+z");
  await expectDraft(page, source);
  await page.screenshot({ path: test.info().outputPath("markdown.png"), animations: "disabled" });
});

test("slash completion is one undo step and cursor moves don't replace the document", async () => {
  const page = await start();
  await composer(page).focus();
  await page.keyboard.type("/sess");
  await page.keyboard.press("Tab");
  await expectDraft(page, "/session ");
  await page.keyboard.press("ControlOrMeta+z");
  await expectDraft(page, "/sess");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectDraft(page, "/session ");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ControlOrMeta+z");
  await expectDraft(page, "/sess");

  await composer(page).fill("abc");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expectDraft(page, "abXc");
});

test("Up recalls only this thread's prompts, Down restores the draft, and edits end browsing", async () => {
  const page = await start();
  await send(page, "First prompt.");
  await expect(page.getByText("First reply.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await send(page, "Second prompt.");
  await expect(page.getByText("Second reply.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await composer(page).press("ArrowUp");
  await expectDraft(page, "Second prompt.");
  await composer(page).press("ArrowUp");
  await expectDraft(page, "First prompt.");
  await composer(page).press("ArrowDown");
  await expectDraft(page, "Second prompt.");
  await composer(page).press("ArrowDown");
  await expectDraft(page, "");
  await composer(page).press("ArrowUp");
  await page.keyboard.type(" changed");
  await composer(page).press("ArrowUp");
  await expectDraft(page, "Second prompt. changed");
  // Undoing the edit mustn't re-enter history browsing merely because the text matches again.
  await composer(page).press("ControlOrMeta+z");
  await expectDraft(page, "Second prompt.");
  await composer(page).press("ArrowUp");
  await expectDraft(page, "Second prompt.");
  await composer(page).fill("Second prompt. changed");

  await page.keyboard.press("ControlOrMeta+n");
  await waitForPi(page);
  await expectDraft(page, "");
  await composer(page).press("ArrowUp");
  await expectDraft(page, "");
  await composer(page).press("ControlOrMeta+z");
  await expectDraft(page, "");
  await threadRows(page).filter({ hasText: "First prompt." }).click();
  await expectDraft(page, "Second prompt. changed");
});

test("a multiline Markdown draft survives quitting and restarting the entire app", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({ workDir, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  const source = '# Not sent\n\n  keep indentation\n@"space name.txt"\n';
  await composer(tondo.page).fill(source);
  await expectDraft(tondo.page, source);
  // Wait for actual persistence, not an arbitrary debounce delay.
  await expect
    .poll(() => {
      const db = new DatabaseSync(path.join(profileDir, "tondo.sqlite"), { readOnly: true });
      try {
        return db.prepare("SELECT draft FROM threads").get()?.draft;
      } finally {
        db.close();
      }
    })
    .toBe(source);
  await tondo.close();

  const secondRun = path.join(workDir, "second-run");
  mkdirSync(secondRun);
  tondo = await launchWithPi({ workDir: secondRun, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await waitForPi(tondo.page);
  await expectDraft(tondo.page, source);
  await composer(tondo.page).press("ControlOrMeta+z");
  await expectDraft(tondo.page, source);
});
