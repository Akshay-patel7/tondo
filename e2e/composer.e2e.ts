import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

test("right-click spelling suggestions correct the draft and can be undone", async () => {
  // macOS has an OS dictionary. Linux needs a downloaded Hunspell dictionary,
  // so its offline coverage is in the context-menu unit tests.
  test.skip(process.platform !== "darwin", "Needs the native macOS spelling dictionary");
  const page = await start();
  await tondo!.app.evaluate(({ Menu }) => {
    // Playwright cannot drive native menu items. Capture the real menu built
    // by the right-click handler and invoke its item below.
    const state = globalThis as typeof globalThis & { spellingMenu?: Electron.Menu };
    Menu.prototype.popup = function () {
      state.spellingMenu = this;
    };
  });
  await expect
    .poll(async () => {
      await composer(page).press("ControlOrMeta+a");
      await page.keyboard.type("This is mispelled. ");
      // Blur and refocus to trigger Chromium's full check after the dictionary starts up.
      await page.getByRole("heading", { name: "New thread", exact: true }).click();
      await composer(page).focus();
      const point = await composer(page).evaluate((element) => {
        const text = element.querySelector("p")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 8);
        range.setEnd(text, 17);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y, { button: "right" });
      return tondo!.app.evaluate(() => {
        const state = globalThis as typeof globalThis & { spellingMenu?: Electron.Menu };
        return state.spellingMenu?.items.map((item) => item.label);
      });
    })
    .toContain("misspelled");
  await tondo!.app.evaluate(({ BrowserWindow }) => {
    const state = globalThis as typeof globalThis & { spellingMenu?: Electron.Menu };
    const suggestion = state.spellingMenu!.items.find((item) => item.label === "misspelled")!;
    suggestion.click(undefined, BrowserWindow.getAllWindows()[0], {});
  });
  await expectDraft(page, "This is misspelled. ");
  await page.screenshot({
    path: test.info().outputPath("spelling-corrected.png"),
    animations: "disabled",
  });
  await composer(page).press("ControlOrMeta+z");
  await expectDraft(page, "This is mispelled. ");
  await composer(page).press("ControlOrMeta+Shift+z");
  await expectDraft(page, "This is misspelled. ");
  await composer(page).press("Enter");
  await expect(page.getByText("First reply.", { exact: true })).toBeVisible();
  expect(await page.locator('[data-index="0"]').textContent()).toBe("This is misspelled.");
});

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

test("@ completion inserts pi's quoted path, is undoable and never expands file contents", async () => {
  execFileSync("git", ["init", "-q"], { cwd: project });
  writeFileSync(path.join(project, "space name.txt"), "CONTENTS MUST NOT BE SENT");
  writeFileSync(path.join(project, "tracked.txt"), "tracked");
  writeFileSync(path.join(project, ".gitignore"), "ignored.txt\n");
  writeFileSync(path.join(project, "ignored.txt"), "not listed");
  execFileSync("git", ["add", "tracked.txt"], { cwd: project });
  const page = await start();
  await composer(page).focus();
  await page.keyboard.type("Read @");
  const menu = page.getByRole("listbox", { name: "Files" });
  await expect(menu.getByRole("option", { name: "tracked.txt", exact: true })).toBeVisible();
  await expect(menu.getByRole("option", { name: "ignored.txt", exact: true })).toHaveCount(0);
  await page.keyboard.type("space");
  await expect(menu.getByRole("option")).toHaveText(["space name.txt"]);
  await page.screenshot({ path: test.info().outputPath("files.png"), animations: "disabled" });
  await composer(page).dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expectDraft(page, "Read @space");
  await page.keyboard.press("Enter");
  await expectDraft(page, 'Read @"space name.txt" ');
  await expect(page.locator("[data-index]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expectDraft(page, "Read @space");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectDraft(page, 'Read @"space name.txt" ');
  await page.keyboard.type("please.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("First reply.", { exact: true })).toBeVisible();
  expect(await page.locator('[data-index="0"]').textContent()).toBe(
    'Read @"space name.txt" please.',
  );
});

test("reopening file completion reads new files, and a non-Git project says why it has no menu items", async () => {
  const page = await start();
  await composer(page).fill("@");
  const menu = page.getByRole("listbox", { name: "Files" });
  await expect(menu).toContainText("File suggestions need a Git project");
  await composer(page).press("Escape");
  await expect(menu).toBeHidden();
  execFileSync("git", ["init", "-q"], { cwd: project });
  writeFileSync(path.join(project, "new.txt"), "");
  // fill("") selects the DOM and presses Delete, which can reach ProseMirror
  // before the selectionchange event and delete nothing. Select in the editor.
  await composer(page).press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expectDraft(page, "");
  await composer(page).press("Shift+Enter");
  await page.keyboard.type("@new");
  await expect(menu.getByRole("option")).toHaveText(["new.txt"]);
  await menu.getByRole("option").click();
  await expectDraft(page, "\n@new.txt ");
  await expect(composer(page)).toBeFocused();
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

test("a draft typed right before quitting survives the restart", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({ workDir, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  const source = "Typed right before quit";
  await composer(tondo.page).fill(source);
  await expectDraft(tondo.page, source);
  // Quits at once, inside the composer's save delay. It's app.quit(), as Cmd+Q is.
  await tondo.close();
  const db = new DatabaseSync(path.join(profileDir, "tondo.sqlite"), { readOnly: true });
  try {
    expect(db.prepare("SELECT draft FROM threads").get()?.draft).toBe(source);
  } finally {
    db.close();
  }

  const secondRun = path.join(workDir, "second-run");
  mkdirSync(secondRun);
  tondo = await launchWithPi({ workDir: secondRun, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await waitForPi(tondo.page);
  await expectDraft(tondo.page, source);
});

test("@ completion in a project of over 10,000 files finds files past the index by name", async () => {
  execFileSync("git", ["init", "-q"], { cwd: project });
  mkdirSync(path.join(project, "bulk"));
  for (let n = 0; n < 12_000; n++)
    writeFileSync(path.join(project, "bulk", `f${String(n).padStart(5, "0")}.txt`), "");
  mkdirSync(path.join(project, "src"));
  writeFileSync(path.join(project, "src", "main.ts"), "");
  const page = await start();
  await composer(page).focus();
  await page.keyboard.type("@");
  const menu = page.getByRole("listbox", { name: "Files" });
  await expect(menu).toContainText("over 10,000 files");
  await page.keyboard.type("main.ts");
  await expect(menu.getByRole("option")).toHaveText(["src/main.ts"]);
  await composer(page).press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expectDraft(page, "");
  await page.keyboard.type("@f11999");
  await expect(menu.getByRole("option")).toHaveText(["bulk/f11999.txt"]);
  await page.keyboard.press("Enter");
  await expectDraft(page, "@bulk/f11999.txt ");
});
