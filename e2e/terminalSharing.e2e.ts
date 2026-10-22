import type { UserMessage } from "@earendil-works/pi-ai";
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TERMINAL_CONTEXT_CHARS } from "../src/shared/terminal";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import { listenOnPort, type PerfWindow } from "./perf";
import {
  addProject,
  composer,
  launchWithPi,
  reply,
  send,
  threads,
  waitForIdle,
  waitForPi,
} from "./pi";

let dir: string;
let profileDir: string;
let inputs: string;
let tondo: Tondo;
let errors: string[];

test.beforeEach(async () => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-terminal-sharing-")));
  const project = path.join(dir, "project");
  profileDir = path.join(dir, "profile");
  inputs = path.join(dir, "inputs.json");
  mkdirSync(project);
  mkdirSync(profileDir);
  errors = [];
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    script: {
      recordInputs: inputs,
      responses: Array.from({ length: 20 }, (_, i) => reply(`Response ${i}.`)),
    },
  });
  tondo.page.on("pageerror", (error) => errors.push(error.message));
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
});

test.afterEach(async () => {
  await tondo.close();
  rmSync(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

function received(): string[] {
  if (!existsSync(inputs)) return [];
  const messages = JSON.parse(readFileSync(inputs, "utf8")) as UserMessage[];
  return messages.map((message) =>
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
  );
}

async function post(text: string): Promise<string> {
  await send(tondo.page, text);
  await expect.poll(() => received().at(-1)?.startsWith(text)).toBe(true);
  await waitForIdle(tondo.page);
  return received().at(-1)!;
}

async function command(text: string, marker: string): Promise<void> {
  const input = tondo.page.locator(".xterm-helper-textarea");
  await input.focus();
  await input.pressSequentially(text);
  await input.press("Enter");
  await expect(tondo.page.locator(".xterm-accessibility-tree")).toContainText(marker);
}

async function openTerminal(): Promise<void> {
  await tondo.page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(tondo.page.locator(".xterm-helper-textarea")).toBeAttached();
}

function sharing() {
  return tondo.page.getByRole("switch", { name: "Share terminal output with chat" });
}

function attachment() {
  return tondo.page.getByRole("group", { name: "Pending terminal output" });
}

async function preview() {
  await attachment().getByRole("button", { name: "Preview", exact: true }).click();
  return tondo.page.getByRole("dialog", { name: "Terminal output", exact: true });
}

test("zero, one and four commands attach only actual new output, without automatic agent turns", async () => {
  const { page } = tondo;
  await openTerminal();
  await expect(sharing()).not.toBeChecked();
  await command("printf 'PRIVATE_%s\\n' HISTORY", "PRIVATE_HISTORY");
  await sharing().click();
  await expect(sharing()).toBeChecked();
  expect(await post("Let's discuss before running anything.")).toBe(
    "Let's discuss before running anything.",
  );
  await expect(attachment()).toBeHidden();

  const callsBefore = received().length;
  await command("printf 'FIRST_%s\\n' ONLY", "FIRST_ONLY");
  await expect(attachment()).toBeVisible();
  expect(received()).toHaveLength(callsBefore);
  // The window opens at 1200x800 where the screen has room. macOS CI runners
  // fit only 1024x677, and macOS caps a window's height at the screen's, so the
  // test puts back the size the window opened at.
  const opened = await tondo.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getSize(),
  );
  const viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await tondo.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(840, 620),
  );
  await page.waitForFunction(() => window.innerWidth === 840 && window.innerHeight === 620);
  const terminalBounds = (await page
    .getByRole("region", { name: "Terminal", exact: true })
    .boundingBox())!;
  const attachedBounds = (await attachment().boundingBox())!;
  const switchBounds = (await sharing().boundingBox())!;
  expect(attachedBounds.y + attachedBounds.height).toBeLessThanOrEqual(terminalBounds.y);
  expect(switchBounds.x + switchBounds.width).toBeLessThanOrEqual(
    terminalBounds.x + terminalBounds.width,
  );
  await page.screenshot({
    path: test.info().outputPath("terminal-sharing-minimum.png"),
    animations: "disabled",
  });
  await tondo.app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size[0]!, size[1]!),
    opened,
  );
  await page.waitForFunction(
    ([width, height]) => window.innerWidth === width && window.innerHeight === height,
    viewport,
  );
  const dialog = await preview();
  await expect(dialog.getByLabel("Captured terminal output")).toContainText("FIRST_ONLY");
  await expect(dialog).toContainText("Slash commands don't send this attachment.");
  await expect(dialog).not.toContainText("PRIVATE_HISTORY");
  for (const scheme of ["light", "dark"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- both screenshots use the same page.
    await page.emulateMedia({ colorScheme: scheme });
    // oxlint-disable-next-line eslint/no-await-in-loop -- capture this theme before changing it.
    await page.screenshot({
      path: test.info().outputPath(`terminal-preview-${scheme}.png`),
      animations: "disabled",
    });
  }
  await page.keyboard.press("Escape");
  const first = await post("I ran only the first command.");
  expect(first).toContain("<tondo_terminal_output>");
  expect(first).toContain("FIRST_ONLY");
  expect(first).not.toContain("PRIVATE_HISTORY");
  await expect(attachment()).toBeHidden();
  expect(await post("What does that mean?")).toBe("What does that mean?");

  for (let i = 1; i <= 4; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- type each command into the same shell in order.
    await command(`printf 'BATCH_%s\\n' ${i}`, `BATCH_${i}`);
  }
  await page.screenshot({
    path: test.info().outputPath("terminal-attachment.png"),
    animations: "disabled",
  });
  const batch = await post("Here are all four results.");
  expect(batch).not.toContain("FIRST_ONLY");
  const positions = [1, 2, 3, 4].map((i) => batch.indexOf(`BATCH_${i}`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  expect(batch.match(/<tondo_terminal_output>/g)).toHaveLength(1);
  await expect(attachment()).toBeHidden();
});

test("typing, resizing, focus changes and reopening cannot create an attachment without submission", async () => {
  const { page } = tondo;
  await listenOnPort(tondo);
  await waitForPi(page);
  await openTerminal();
  await command("PS1='SHARE_PROMPT> '; PROMPT=$PS1; printf 'READY_%s\\n' SHARE", "READY_SHARE");
  const rows = page.locator(".xterm-accessibility-tree > div");
  const prompt = async () => (await rows.allTextContents()).findLast((row) => row.trim())?.trim();
  await expect.poll(prompt).toBe("SHARE_PROMPT>");
  await sharing().click();
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await input.pressSequentially("printf 'UNSUBMITTED_%s\\n' TEXT");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("UNSUBMITTED_");
  await expect(attachment()).toBeHidden();
  expect(await post("I have not run that command.")).toBe("I have not run that command.");
  await input.focus();
  await input.press("Control+u");
  await expect.poll(prompt).toBe("SHARE_PROMPT>");

  // Wait for actual PTY redraw bytes, not a quiet-period timeout, before checking capture.
  const redrawAfter = async (action: () => Promise<void>) => {
    const observed = await page.evaluateHandle(() => {
      const state = { output: "" };
      (window as PerfWindow).tondoPerf!.onMessage = ({ data }) => {
        if (data.type === "terminal-output") state.output += data.data;
      };
      return state;
    });
    await action();
    await expect.poll(() => observed.evaluate((state) => state.output)).toContain("SHARE_PROMPT>");
    await observed.dispose();
  };
  const grip = page.getByRole("separator", { name: "Resize terminal" });
  await redrawAfter(() => grip.press("ArrowUp"));
  await expect(attachment()).toBeHidden();
  await redrawAfter(async () => {
    const box = (await grip.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 48, { steps: 4 });
    await page.mouse.up();
  });
  await expect(attachment()).toBeHidden();
  expect(await post("Only resized the terminal.")).toBe("Only resized the terminal.");

  await command("printf 'DISCARD_%s\\n' OUTPUT", "DISCARD_OUTPUT");
  await expect(attachment()).toBeVisible();
  await attachment().getByRole("button", { name: "Discard terminal output" }).click();
  await redrawAfter(() => grip.press("ArrowDown"));
  await expect(attachment()).toBeHidden();
  expect(await post("Discarded means discarded.")).toBe("Discarded means discarded.");

  await command("printf 'SUBMITTED_%s\\n' OUTPUT", "SUBMITTED_OUTPUT");
  expect(await post("Here is the command output.")).toContain("SUBMITTED_OUTPUT");
  await redrawAfter(() => page.getByRole("button", { name: "Hide sidebar", exact: true }).click());
  await expect(attachment()).toBeHidden();
  await page.reload();
  await expect(sharing()).toBeChecked();
  await expect.poll(prompt).toBe("SHARE_PROMPT>");
  await expect(attachment()).toBeHidden();
  expect(await post("No new command after sending or reopening.")).toBe(
    "No new command after sending or reopening.",
  );
  await page.screenshot({ path: test.info().outputPath("terminal-no-incidental-attachment.png") });
});

test("preview, discard, opt-out and bounded logs control exactly what reaches real pi", async () => {
  const { page } = tondo;
  await openTerminal();
  await sharing().click();
  await command("printf 'SECRET_%s\\n' SYNTHETIC", "SECRET_SYNTHETIC");
  const dialog = await preview();
  await expect(dialog.getByLabel("Captured terminal output")).toContainText("SECRET_SYNTHETIC");
  await page.keyboard.press("Escape");
  await attachment().getByRole("button", { name: "Discard terminal output" }).click();
  await expect(attachment()).toBeHidden();
  await expect(sharing()).toBeChecked();
  expect(await post("Do not include the discarded output.")).toBe(
    "Do not include the discarded output.",
  );
  await sharing().click();
  await command("printf 'OFF_%s\\n' OUTPUT", "OFF_OUTPUT");
  expect(await post("Sharing is off.")).toBe("Sharing is off.");
  await sharing().click();
  await command(
    'awk \'BEGIN { for (i=0; i<2000; i++) print "bounded output line"; printf "LARGE_%s\\n", "DONE" }\'',
    "LARGE_DONE",
  );
  const large = await preview();
  await expect(large).toContainText("Earlier output was omitted");
  const text = await large.getByLabel("Captured terminal output").textContent();
  expect(text!.length).toBeLessThanOrEqual(TERMINAL_CONTEXT_CHARS);
  expect(text).toContain("LARGE_DONE");
  await page.screenshot({
    path: test.info().outputPath("terminal-truncated.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const result = await post("Inspect this long log.");
  expect(result).toContain("earlier output was omitted");
  expect(result).toContain("LARGE_DONE");
  expect(result).not.toContain("SECRET_SYNTHETIC");
  expect(result).not.toContain("OFF_OUTPUT");
});

test("sharing and pending output stay with their thread through switches and reload; opt-in survives restart", async () => {
  const { page } = tondo;
  await post("Keep this first thread.");
  await openTerminal();
  await sharing().click();
  await command("printf 'FIRST_THREAD_%s\\n' OUTPUT", "FIRST_THREAD_OUTPUT");
  await page.reload();
  await expect(sharing()).toBeChecked();
  await expect(attachment()).toBeVisible();
  await composer(page).press("ControlOrMeta+n");
  await waitForPi(page);
  await openTerminal();
  await expect(sharing()).not.toBeChecked();
  await expect(attachment()).toBeHidden();
  await command("printf 'SECOND_THREAD_%s\\n' PRIVATE", "SECOND_THREAD_PRIVATE");
  expect(await post("Keep this second thread.")).toBe("Keep this second thread.");
  await threads(page).locator("button[data-thread-id]:not([aria-current])").click();
  await waitForPi(page);
  await expect(sharing()).toBeChecked();
  const dialog = await preview();
  await expect(dialog.getByLabel("Captured terminal output")).toContainText("FIRST_THREAD_OUTPUT");
  await expect(dialog).not.toContainText("SECOND_THREAD_PRIVATE");
  await page.keyboard.press("Escape");
  const first = await post("Attach only this thread's output.");
  expect(first).toContain("FIRST_THREAD_OUTPUT");
  expect(first).not.toContain("SECOND_THREAD_PRIVATE");
  await tondo.close();
  tondo = await launchTondo({ profileDir });
  await bringToFront(tondo);
  await waitForPi(tondo.page);
  await openTerminal();
  await expect(sharing()).toBeChecked();
  await tondo.page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(tondo.page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  // A new shell's startup text is ordinary shell output too. Discard it before sign-in.
  if (await attachment().isVisible())
    await attachment().getByRole("button", { name: "Discard terminal output" }).click();
  const previous = received().at(-1);
  await send(tondo.page, "/login");
  await expect(tondo.page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expect(sharing()).toBeHidden();
  await expect(attachment()).toBeHidden();
  expect(received().at(-1)).toBe(previous);
});
