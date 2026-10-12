// Extension UI over pi's RPC: a test extension (scripts/fixtures/ui-ext.ts)
// calls every method, and each dialog's answer makes the round trip back to
// it. A dialog from a thread off screen badges the thread and raises a
// notification, which opens the thread.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threads,
  waitForIdle,
  waitForPi,
} from "./pi";

test.describe.configure({ timeout: 60_000 });

const UI_EXTENSION = path.resolve(__dirname, "../scripts/fixtures/ui-ext.ts");

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-extensions-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * An extension for the edge cases ui-ext.ts leaves out. /tondo-set-when sets
 * the composer's text once a file exists. /tondo-duplicate asks twice with
 * one id, as a misbehaving extension might, then says it's done.
 */
const EDGE_EXTENSION = `
import { existsSync, writeSync } from "node:fs";

export default function edgeExtension(pi) {
  pi.registerCommand("tondo-set-when", {
    description: "Sets the composer's text once a file exists",
    handler: async (file, ctx) => {
      while (!existsSync(file.trim())) await new Promise((resolve) => setTimeout(resolve, 20));
      ctx.ui.setEditorText("Text from the extension");
      ctx.ui.notify("The extension set the text", "info");
    },
  });
  pi.registerCommand("tondo-duplicate", {
    description: "Asks twice with one id",
    handler: async () => {
      const ask = (title, options) =>
        JSON.stringify({ type: "extension_ui_request", id: "dup", method: "select", title, options });
      writeSync(1, ask("First with the id", ["a", "b"]) + "\\n");
      writeSync(1, ask("Second with the id", ["x", "y"]) + "\\n");
      const done = { type: "extension_ui_request", id: "done", method: "notify", message: "Asked twice" };
      writeSync(1, JSON.stringify(done) + "\\n");
    },
  });
}
`;

/** A notification main raised. The test keeps them instead of showing them. */
type MainNotification = InstanceType<typeof import("electron").Notification>;
type NotificationState = typeof globalThis & { tondoNotifications?: MainNotification[] };

/** The window's title, which an extension's setTitle sets. */
function windowTitle(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
}

test("an extension's dialogs, toasts, status, widgets, title and composer text", async () => {
  tondo = await launchWithPi({
    workDir,
    script: { responses: [] },
    piArgs: ["-e", UI_EXTENSION],
  });
  const { app, page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  expect(await windowTitle(app)).toBe("Tondo");

  await send(page, "/tondo-ui");
  await expect(
    page.getByRole("status").filter({ hasText: "The extension says hello" }),
  ).toBeVisible();
  // The status row names each entry by its key, then shows the extension's text.
  const status = page.getByLabel("Extension status").getByRole("listitem");
  await expect(status).toHaveText(["tondoChecking the extension UI"]);
  await expect(status).toHaveAttribute("data-status", "tondo");
  await expect(page.getByLabel("Extension widgets", { exact: true })).toHaveText(
    "Widget above the composer",
  );
  await expect(page.getByLabel("Extension widgets below")).toHaveText(
    "Widget below the composer\n  second line",
  );
  await expect.poll(() => windowTitle(app)).toBe("Tondo UI test");

  // The dialog takes the composer's place and has the keyboard.
  const pick = page.getByRole("dialog", { name: "Pick a fruit" });
  await expect(pick).toBeVisible();
  await expect(composer(page)).toBeHidden();
  await expect(pick.getByRole("listbox")).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("select.png"), animations: "disabled" });
  await page.keyboard.press("ArrowDown");
  await expect(pick.getByRole("option", { name: "pear" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  const confirm = page.getByRole("dialog", { name: "Keep going?" });
  await expect(confirm).toContainText("The extension asks before it goes on.");
  await confirm.getByRole("option", { name: "Yes" }).click();

  const input = page.getByRole("dialog", { name: "Your name?" });
  await expect(input.getByRole("textbox")).toBeFocused();
  await expect(input.getByRole("textbox")).toHaveAttribute("placeholder", "Name");
  await page.keyboard.type("Ada");
  await page.keyboard.press("Enter");

  const editor = page.getByRole("dialog", { name: "Edit the note" });
  await expect(editor.getByRole("textbox")).toHaveValue("first line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");
  await page.screenshot({ path: test.info().outputPath("editor.png"), animations: "disabled" });
  await page.keyboard.press("Enter");

  // pi answers a timed dialog itself when time runs out, and it closes here too.
  const timed = page.getByRole("dialog", { name: /^Answer in time \(\ds\)$/ });
  await expect(timed).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("countdown.png"), animations: "disabled" });
  await expect(timed).toBeHidden();

  // Every answer reached the extension.
  await expect(
    page.getByRole("status").filter({
      hasText: 'fruit=pear sure=true name=Ada note="first line\\nsecond line" late=undefined',
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Extension widgets", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Extension status")).toBeHidden();
  await expect(page.getByLabel("Extension widgets below")).toBeVisible();
  // The composer came back with the text the extension set, and the keyboard.
  await expectDraft(page, "Text from the extension");
  await expect(composer(page)).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("after.png"), animations: "disabled" });

  // The title belongs to the thread, so another thread shows Tondo's own.
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
  await expect.poll(() => windowTitle(app)).toBe("Tondo");
});

test("an extension's composer text keeps the draft you typed", async () => {
  const extension = path.join(workDir, "edge-ext.ts");
  writeFileSync(extension, EDGE_EXTENSION);
  const release = path.join(workDir, "release");
  tondo = await launchWithPi({ workDir, script: { responses: [] }, piArgs: ["-e", extension] });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, `/tondo-set-when ${release}`);
  await composer(page).fill("my precious draft");
  await expectDraft(page, "my precious draft");
  writeFileSync(release, "");
  await expect(
    page.getByRole("status").filter({ hasText: "The extension set the text" }),
  ).toBeVisible();
  await expectDraft(page, "my precious draft\n\nText from the extension");
});

test("a second dialog with an open dialog's id leaves the first one open", async () => {
  const extension = path.join(workDir, "edge-ext.ts");
  writeFileSync(extension, EDGE_EXTENSION);
  tondo = await launchWithPi({ workDir, script: { responses: [] }, piArgs: ["-e", extension] });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "/tondo-duplicate");
  // The notify comes after both requests, so the host has read the second by now.
  await expect(page.getByRole("status").filter({ hasText: "Asked twice" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "First with the id" })).toBeVisible();
  await expect(page.getByText("1/2")).toBeHidden();
  await page.keyboard.press("1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
});

test("an extension's question in a thread off screen badges it and raises a notification", async () => {
  const release = path.join(workDir, "release");
  tondo = await launchWithPi({
    workDir,
    script: { responses: [reply("Ready.")] },
    piArgs: ["-e", UI_EXTENSION],
  });
  const { app, page } = tondo;
  await bringToFront(tondo);
  // Main's notifications land here instead of on screen, on runners with no
  // notification service too.
  await app.evaluate(({ Notification }) => {
    const state = globalThis as NotificationState;
    state.tondoNotifications = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function show(this: MainNotification) {
      state.tondoNotifications!.push(this);
    };
  });
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Get ready.");
  await expect(page.getByText("Ready.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await send(page, `/tondo-ask-when ${release}`);

  // Another thread goes on screen, and then the first one asks.
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
  writeFileSync(release, "");
  const asking = threads(page).locator("li", { hasText: "Get ready." });
  await expect(asking.getByRole("img", { name: "Waiting for your answer" })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(() =>
        (globalThis as NotificationState).tondoNotifications!.map(({ title, body }) => ({
          title,
          body,
        })),
      ),
    )
    .toEqual([{ title: "Get ready.", body: "Deploy now?" }]);
  // Its notify shows too, naming the thread it came from.
  const notified = page.getByRole("status").filter({ hasText: "The build is ready" });
  await expect(notified).toContainText("Get ready.");
  await threads(page).screenshot({ path: test.info().outputPath("badge.png") });
  await page.screenshot({ path: test.info().outputPath("background.png"), animations: "disabled" });

  // Clicking the notification opens the thread, and its question waits there.
  await app.evaluate(() => {
    (globalThis as NotificationState).tondoNotifications![0]!.emit("click");
  });
  const question = page.getByRole("dialog", { name: "Deploy now?" });
  await expect(question).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByRole("status").filter({ hasText: "answer=Deploy" })).toBeVisible();
  await expect(asking.getByRole("img", { name: "Waiting for your answer" })).toBeHidden();
});
