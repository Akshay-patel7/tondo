// oxlint-disable eslint/no-await-in-loop -- theme and viewport gestures must complete in sequence on the same page.
import { chromium, webkit, devices, expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { REMOTE_PORT } from "../src/shared/remote";
import { sessionFolder } from "./sessions";
import { hostPid, launchTondo, type Tondo } from "./launch";
import { allProcesses } from "./processes";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threadRows,
  toolCalls,
  waitForPi,
} from "./pi";

const BASE = `http://127.0.0.1:${REMOTE_PORT}`;
let workDir: string;
let tondo: Tondo | undefined;
let browser: Browser | undefined;

test.describe.configure({ timeout: 90_000 });
test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-remote-e2e-")));
});
test.afterEach(async () => {
  if (browser && test.info().status !== test.info().expectedStatus) {
    let index = 0;
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        const prefix = `phone-failure-${index++}`;
        try {
          writeFileSync(
            test.info().outputPath(`${prefix}.txt`),
            await page.locator("body").ariaSnapshot(),
          );
          await page.screenshot({
            path: test.info().outputPath(`${prefix}.png`),
            animations: "disabled",
            timeout: 1000,
          });
        } catch {
          /* Cleanup must still run if the failing page has already closed. */
        }
      }
  }
  await browser?.close();
  browser = undefined;
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

async function runningPi(app: Tondo["app"]): Promise<number[]> {
  const parent = await hostPid(app);
  return allProcesses()
    .filter(
      (entry) =>
        Number(entry.line.split(/\s+/)[2]) === parent &&
        (entry.line.endsWith(" pi") || entry.line.includes("--mode rpc")),
    )
    .map((entry) => entry.pid)
    .toSorted();
}

async function settings(page: Page) {
  await expect(page.getByRole("button", { name: "Add project", exact: true })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Comma");
  const region = page.getByRole("region", { name: "Settings", exact: true });
  await region
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  return region;
}

async function pair(phone: Page, code: string) {
  await phone.goto(BASE);
  await expect(phone.getByRole("textbox", { name: "Pairing code" })).toBeVisible();
  await phone.screenshot({
    path: test.info().outputPath("remote-pairing-light.png"),
    animations: "disabled",
  });
  await phone.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => phone.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await phone.screenshot({
    path: test.info().outputPath("remote-pairing-dark.png"),
    animations: "disabled",
  });
  await phone.emulateMedia({ colorScheme: "light" });
  await phone.getByRole("textbox", { name: "Pairing code" }).fill(code);
  await phone.getByRole("button", { name: "Connect to Tondo" }).click();
  await expect(phone.getByRole("heading", { name: "Your threads" })).toBeVisible();
  await expect(phone.getByRole("textbox", { name: "Pairing code" })).toBeHidden();
  await expect(phone.locator("button[data-thread-id]").first()).toBeVisible();
}

for (const engine of [chromium, webkit]) {
  test(`${engine.name()}: iPhone controls shared threads without changing desktop selection or drafts`, async () => {
    const project = path.join(workDir, "project");
    mkdirSync(project);
    tondo = await launchWithPi({
      workDir,
      script: {
        responses: [
          reply("First shared reply."),
          reply("Second shared reply."),
          reply("Storage fallback reply."),
        ],
      },
    });
    const desktop = tondo.page;
    await addProject(tondo, project);
    await waitForPi(desktop);
    await send(desktop, "Desktop seed");
    await expect(desktop.getByText("First shared reply.", { exact: true })).toBeVisible();
    const firstId = await threadRows(desktop).first().getAttribute("data-thread-id");
    expect(firstId).toBeTruthy();
    const previousComposer = await composer(desktop).elementHandle();
    await desktop.keyboard.press("ControlOrMeta+n");
    await desktop.waitForFunction((element) => !element?.isConnected, previousComposer);
    await previousComposer?.dispose();
    await waitForPi(desktop);
    await composer(desktop).fill("My Mac draft must stay here");
    await expectDraft(desktop, "My Mac draft must stay here");
    const region = await settings(desktop);
    const toggle = region.getByRole("switch", { name: "Remote access", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    const code = region.getByRole("textbox", { name: "Pairing code", exact: true });
    await expect(code).toHaveValue(/\S{32}/);
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(path.join(tondo!.profileDir, "settings.json"), "utf8"))
            .remoteAccess,
      )
      .toBe(true);
    await desktop.screenshot({
      path: test.info().outputPath("remote-settings-light.png"),
      animations: "disabled",
    });
    await desktop.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => desktop.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
      .toBe(true);
    await desktop.screenshot({
      path: test.info().outputPath("remote-settings-dark.png"),
      animations: "disabled",
    });
    await desktop.emulateMedia({ colorScheme: "light" });
    const pairingCode = await code.inputValue();
    const groupsBefore = await runningPi(tondo.app);
    expect(groupsBefore).toHaveLength(2);
    browser = await engine.launch();
    const context = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "light" });
    const phone = await context.newPage();
    const pageErrors: string[] = [];
    phone.on("pageerror", (error) => pageErrors.push(error.message));
    phone.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await pair(phone, pairingCode);
    await phone.screenshot({ path: test.info().outputPath("remote-threads-light.png") });
    await phone.locator(`button[data-thread-id="${firstId}"]`).click();
    const message = phone.getByRole("textbox", { name: "Message", exact: true });
    await expect(phone.getByRole("button", { name: "Send message" })).toBeDisabled();
    await message.fill("Sent from my iPhone");
    await expect(phone.getByRole("button", { name: "Send message" })).toBeEnabled();
    await phone.getByRole("button", { name: "Send message" }).click();
    await expect(phone.getByText("Second shared reply.", { exact: true })).toBeVisible();
    await expect(message).toHaveValue("");
    const secondId = (
      await threadRows(desktop).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-thread-id")),
      )
    ).find((id) => id !== firstId);
    expect(secondId).toBeTruthy();
    const otherContext = await browser.newContext({ ...devices["iPhone 13"] });
    const otherPhone = await otherContext.newPage();
    await pair(otherPhone, pairingCode);
    await otherPhone.locator(`button[data-thread-id="${secondId}"]`).click();
    await expect(otherPhone.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    await expect(phone.getByRole("heading", { name: "Desktop seed", exact: true })).toBeVisible();
    expect(await runningPi(tondo.app)).toEqual(groupsBefore);
    await otherContext.close();
    await desktop.locator("header").getByRole("button", { name: "Back", exact: true }).click();
    await expectDraft(desktop, "My Mac draft must stay here");
    await expect(desktop.getByText("Sent from my iPhone", { exact: true })).toBeHidden();
    await desktop.locator(`button[data-thread-id="${firstId}"]`).click();
    await expect(desktop.getByText("Second shared reply.", { exact: true })).toBeVisible();
    await composer(desktop).fill("Desktop draft in the same thread");
    await message.fill("Private phone draft");
    await phone.reload();
    await expect(phone.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
      "Private phone draft",
    );
    await expectDraft(desktop, "Desktop draft in the same thread");
    for (const colorScheme of ["light", "dark"] as const) {
      await phone.emulateMedia({ colorScheme });
      await expect
        .poll(() => phone.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(colorScheme === "dark");
      for (const viewport of [
        { width: 375, height: 667 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
      ]) {
        await phone.setViewportSize(viewport);
        expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const box = await phone.getByRole("button", { name: "Send message" }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await phone.screenshot({ path: test.info().outputPath(`remote-chat-${colorScheme}.png`) });
    }
    await phone.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error("Storage quota exceeded");
      };
    });
    await phone
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Send despite full browser storage");
    await expect(
      phone.getByRole("alert").filter({ hasText: "could not save the draft" }),
    ).toBeVisible();
    await phone.getByRole("button", { name: "Send message" }).tap();
    await expect(phone.getByText("Storage fallback reply.", { exact: true })).toBeVisible();
    await expect(phone.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
    expect(pageErrors).toEqual([]);
    const remoteSettings = await settings(desktop);
    await remoteSettings.getByRole("switch", { name: "Remote access", exact: true }).click();
    await expect(remoteSettings.getByRole("textbox", { name: "Pairing code" })).toBeHidden();
    await expect(phone.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
    await expect
      .poll(() =>
        fetch(BASE).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await browser.close();
    browser = undefined;
  });
}

test("mobile diffs, real streaming, offline drafts, reconnection and stopping use the same pi", async () => {
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(path.join(project, "file.txt"), "before\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  const inputs = path.join(workDir, "inputs.json");
  const streamed =
    Array.from({ length: 250 }, (_, i) => `Stream section ${i}.`).join("\n\n") +
    "\n\nREMOTE_STREAM_COMPLETE";
  tondo = await launchWithPi({
    workDir,
    settings: { remoteAccess: true },
    script: {
      tokensPerSecond: 200,
      recordInputs: inputs,
      responses: [
        toolCalls({ name: "write", arguments: { path: "file.txt", content: "after\n" } }),
        reply("Update complete."),
        reply(streamed),
        reply(streamed),
      ],
    },
  });
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, "Make the change");
  await expect(tondo.page.getByText("Update complete.", { exact: true })).toBeVisible();
  const firstId = await threadRows(tondo.page).first().getAttribute("data-thread-id");
  const region = await settings(tondo.page);
  const code = region.getByRole("textbox", { name: "Pairing code" });
  await expect(code).toHaveValue(/\S{32}/);
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  phone.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await pair(phone, await code.inputValue());
  await phone.locator(`button[data-thread-id="${firstId}"]`).click();
  await phone.getByRole("button", { name: "View changes" }).click();
  const panel = phone.getByRole("complementary", { name: "Turn changes" });
  await panel.getByRole("button", { name: "Show diff for file.txt" }).click();
  await expect(panel.locator("diffs-container")).toContainText("before");
  await expect(panel.locator("diffs-container")).toContainText("after");
  expect(
    await panel.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(390);
  await phone.screenshot({ path: test.info().outputPath("remote-diff.png") });
  await panel.getByRole("button", { name: "Close changes" }).click();
  await tondo.page.locator("header").getByRole("button", { name: "Back", exact: true }).click();
  const prompt = "Stream while the phone disconnects";
  const message = phone.getByRole("textbox", { name: "Message", exact: true });
  await message.fill(prompt);
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(message).toHaveValue("");
  const live = phone.locator("[data-streaming]");
  await expect(live).toContainText("Stream section");
  const intermediate = (await live.textContent())!.length;
  expect(intermediate).toBeLessThan(streamed.length);
  await expect.poll(async () => (await live.textContent())!.length).toBeGreaterThan(intermediate);
  await message.fill("My offline draft");
  await context.setOffline(true);
  await expect(phone.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(tondo.page.locator("[data-streaming]")).toHaveCount(0, { timeout: 30_000 });
  await expect(tondo.page.getByText("REMOTE_STREAM_COMPLETE", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(phone.getByText("REMOTE_STREAM_COMPLETE", { exact: true })).toBeVisible();
  await expect(message).toHaveValue("My offline draft");
  const recorded = JSON.parse(readFileSync(inputs, "utf8")) as { content: unknown }[];
  expect(recorded.filter((entry) => JSON.stringify(entry.content).includes(prompt))).toHaveLength(
    1,
  );
  await message.fill("Stop this run");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByRole("button", { name: "Stop agent" })).toBeVisible();
  await phone.getByRole("button", { name: "Stop agent" }).click();
  await expect(phone.getByRole("button", { name: "Stop agent" })).toBeHidden();
  await expect(tondo.page.locator("[data-streaming]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("touch browsing loads saved messages outside the bounded live snapshot without losing the phone draft", async () => {
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  const folder = sessionFolder(process.env.TONDO_E2E_EXECUTABLE ? workDir : profileDir, project);
  mkdirSync(folder, { recursive: true });
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const session = SessionManager.inMemory(project);
  for (let i = 0; i < 150; i++) {
    session.appendMessage({
      role: "user",
      content: `Saved mobile request ${i}`,
      timestamp: Date.now() - 60_000 + i,
    });
    session.appendMessage(reply(`Saved mobile answer ${i}`));
  }
  writeFileSync(
    path.join(folder, `${session.getSessionId()}.jsonl`),
    [session.getHeader(), ...session.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  tondo = await launchWithPi({
    workDir,
    profileDir,
    settings: { remoteAccess: true },
    script: { responses: [] },
    // The packaged faux node wrapper uses this agent folder. Keep the host's
    // read-only session discovery on the same test-owned folder too.
    ...(process.env.TONDO_E2E_EXECUTABLE
      ? { env: { PI_CODING_AGENT_DIR: path.join(workDir, "pi-agent") } }
      : {}),
  });
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  const saved = threadRows(tondo.page).filter({ hasText: "Saved mobile request 0" });
  await expect(saved).toBeVisible();
  const id = await saved.getAttribute("data-thread-id");
  const region = await settings(tondo.page);
  const code = region.getByRole("textbox", { name: "Pairing code" });
  await expect(code).toHaveValue(/\S{32}/);
  browser = await webkit.launch();
  const phone = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await pair(phone, await code.inputValue());
  await phone.locator(`button[data-thread-id="${id}"]`).tap();
  await expect(phone.getByText("Saved mobile answer 149", { exact: true })).toBeVisible();
  await phone
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Draft while browsing history");
  await expect(phone.locator("[data-history-tick]")).toHaveCount(40);
  await phone
    .getByRole("button", { name: "Browse past messages" })
    .tap({ position: { x: 12, y: 1 } });
  await expect(phone.getByRole("article", { name: "You", exact: true }).first()).toHaveText(
    "Saved mobile request 0",
  );
  await expect(phone.getByRole("button", { name: "Back to live" })).toBeVisible();
  await phone.screenshot({ path: test.info().outputPath("remote-saved-history.png") });
  await phone.getByRole("button", { name: "Back to live" }).tap();
  await expect(phone.getByText("Saved mobile answer 149", { exact: true })).toBeVisible();
  await expect(phone.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Draft while browsing history",
  );
});

test("a busy port fails safely and rapid toggles leave no remote listener behind", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(REMOTE_PORT, "127.0.0.1", resolve);
  });
  try {
    tondo = await launchTondo({ settings: { piPath: path.join(workDir, "missing-pi") } });
    const region = await settings(tondo.page);
    const toggle = region.getByRole("switch", { name: "Remote access", exact: true });
    await toggle.click();
    await expect(region.getByRole("alert")).toContainText(/EADDRINUSE|address.*use/i);
    await expect(toggle).toBeChecked();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(region.getByRole("textbox", { name: "Pairing code" })).toHaveValue(/\S{32}/);
    for (let i = 0; i < 3; i++) {
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await toggle.click();
      await expect(toggle).toBeChecked();
    }
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect
      .poll(() =>
        fetch(BASE).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await expect(tondo.page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
  } finally {
    if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

test("toggle survives cold restart, sessions are revoked, and remote extension answers resolve on both devices", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const extension = path.join(workDir, "remote-question.ts");
  writeFileSync(
    extension,
    `export default function(pi) { pi.registerCommand("remote-question", { description: "Ask on either device", handler: async (_args, ctx) => { const answer = await ctx.ui.confirm("Approve remote test?", "Answer on either device."); ctx.ui.setStatus("remote-answer", answer ? "Approved remotely" : "Declined remotely"); } }); }`,
  );
  tondo = await launchWithPi({
    workDir,
    profileDir,
    settings: { remoteAccess: true },
    piArgs: ["-e", extension],
    script: { responses: [reply("Ready.")] },
  });
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, "Saved thread");
  await expect(tondo.page.getByText("Ready.", { exact: true })).toBeVisible();
  const firstId = await threadRows(tondo.page).first().getAttribute("data-thread-id");
  let region = await settings(tondo.page);
  let code = region.getByRole("textbox", { name: "Pairing code" });
  await expect(code).toHaveValue(/\S{32}/);
  const firstCode = await code.inputValue();
  browser = await webkit.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await context.newPage();
  await pair(phone, firstCode);
  await phone.locator(`button[data-thread-id="${firstId}"]`).click();
  await phone.getByRole("textbox", { name: "Message", exact: true }).fill("/remote-question");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByRole("dialog", { name: "Approve remote test?" })).toBeVisible();
  await tondo.page.locator("header").getByRole("button", { name: "Back", exact: true }).click();
  await expect(tondo.page.getByRole("dialog", { name: "Approve remote test?" })).toBeVisible();
  await phone.getByRole("dialog").getByRole("option", { name: "Yes", exact: true }).tap();
  await expect(phone.getByRole("dialog")).toBeHidden();
  await expect(tondo.page.getByRole("dialog")).toBeHidden();
  await tondo.close();
  tondo = await launchTondo({ profileDir });
  region = await settings(tondo.page);
  await expect(region.getByRole("switch", { name: "Remote access", exact: true })).toBeChecked();
  code = region.getByRole("textbox", { name: "Pairing code" });
  await expect(code).toHaveValue(/\S{32}/);
  expect(await code.inputValue()).not.toBe(firstCode);
  await phone.reload();
  await expect(phone.getByRole("textbox", { name: "Pairing code" })).toBeVisible();
  await region.getByRole("switch", { name: "Remote access", exact: true }).click();
  await tondo.close();
  tondo = await launchTondo({ profileDir });
  region = await settings(tondo.page);
  await expect(
    region.getByRole("switch", { name: "Remote access", exact: true }),
  ).not.toBeChecked();
  await expect
    .poll(() =>
      fetch(BASE).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
});
