// oxlint-disable eslint/no-await-in-loop -- mobile gestures and retry cycles share a single page.
import {
  chromium,
  webkit,
  devices,
  expect,
  test,
  type Browser,
  type BrowserType,
  type Page,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REMOTE_PORT } from "../src/shared/remote";
import { addProject, launchWithPi, reply, send, waitForPi } from "./pi";
import type { Tondo } from "./launch";

const BASE = `http://127.0.0.1:${REMOTE_PORT}`;
const SEED = "A long mobile thread title that must not push navigation controls off the screen";
const CONTENT = [
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. A mobile reply with **Markdown**.`),
  "Details are in [the notes](notes.md).",
  "```typescript\nconst longLine = '" + "example".repeat(100) + "';\n```",
  "| Field | Value |\n|---|---|\n| Name | " + "LongUnbrokenValue".repeat(80) + " |",
  "MOBILE_REPLY_END",
].join("\n\n");
let workDir: string;
let tondo: Tondo | undefined;
let browser: Browser | undefined;
let phone: Page | undefined;
let pageErrors: string[];
let consoleErrors: string[];

test.describe.configure({ timeout: 90_000 });
test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-mobile-e2e-")));
  pageErrors = [];
  consoleErrors = [];
});
test.afterEach(async () => {
  if (phone && test.info().status !== test.info().expectedStatus)
    await phone
      .screenshot({ path: test.info().outputPath("phone-failure.png"), timeout: 1000 })
      .catch(() => {});
  await browser?.close();
  await tondo?.close();
  browser = undefined;
  tondo = undefined;
  phone = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

async function start(engine: BrowserType): Promise<Page> {
  const project = path.join(workDir, "mobile-project");
  mkdirSync(project);
  tondo = await launchWithPi({
    workDir,
    settings: { remoteAccess: true },
    script: { responses: [reply(CONTENT), reply("Mobile followup received.")] },
  });
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, SEED);
  await expect(tondo.page.getByText("MOBILE_REPLY_END", { exact: true })).toBeVisible();
  await tondo.page.keyboard.press("ControlOrMeta+Comma");
  await tondo.page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  const code = tondo.page.getByRole("textbox", { name: "Pairing code", exact: true });
  await expect(code).toHaveValue(/\S{32}/);
  browser = await engine.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "light" });
  phone = await context.newPage();
  phone.on("pageerror", (error) => pageErrors.push(error.message));
  phone.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await phone.goto(BASE);
  await phone.getByRole("textbox", { name: "Pairing code" }).fill(await code.inputValue());
  await phone.getByRole("button", { name: "Connect to Tondo" }).tap();
  await phone.locator("button[data-thread-id]").first().tap();
  await expect(phone.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  return phone;
}

function expectCleanConsole(): void {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

async function visualViewport(
  page: Page,
  targetHeight: number | null,
  targetOffset = 0,
): Promise<void> {
  await page.evaluate(
    ({ height, offset }) => {
      const visual = window.visualViewport!;
      if (height === null) {
        Reflect.deleteProperty(visual, "height");
        Reflect.deleteProperty(visual, "offsetTop");
      } else
        Object.defineProperties(visual, {
          height: { configurable: true, value: height },
          offsetTop: { configurable: true, value: offset },
        });
      visual.dispatchEvent(new Event("resize"));
      visual.dispatchEvent(new Event("scroll"));
    },
    { height: targetHeight, offset: targetOffset },
  );
}

for (const engine of [webkit, chromium]) {
  test(`${engine.name()}: new phone drafts stay reachable and browser navigation restores the right thread`, async () => {
    const page = await start(engine);
    const text = page.getByRole("textbox", { name: "Message", exact: true });
    await text.fill("Original thread draft");
    await page.getByRole("button", { name: "Threads", exact: true }).tap();
    await page.getByRole("button", { name: "New thread in mobile-project", exact: true }).tap();
    await expect(text).toHaveValue("");
    await text.fill("Unsent phone draft 🌍\nSecond line");
    await page.getByRole("button", { name: "Threads", exact: true }).tap();
    await expect(page.locator("button[data-thread-id]")).toHaveCount(2);
    const newRow = page.locator("button[data-thread-id]").filter({ hasText: "New thread" });
    await newRow.tap();
    await expect(text).toHaveValue("Unsent phone draft 🌍\nSecond line");
    await page.reload();
    await expect(text).toHaveValue("Unsent phone draft 🌍\nSecond line");
    await expect(page.locator("header h1")).toHaveText("New thread");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your threads", exact: true })).toBeVisible();
    expect(page.url()).toBe(BASE + "/");
    await page.goForward();
    await expect(text).toHaveValue("Unsent phone draft 🌍\nSecond line");
    await text.fill("New mobile conversation");
    await page.getByRole("button", { name: "Send message" }).tap();
    await expect(page.getByText("MOBILE_REPLY_END", { exact: true })).toBeVisible();
    await text.fill("Next draft in the new conversation");
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("New mobile conversation");
    await expect(text).toHaveValue("Next draft in the new conversation");
    await page.getByRole("button", { name: "Threads", exact: true }).tap();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your threads", exact: true })).toBeVisible();
    await page.locator("button[data-thread-id]").filter({ hasText: SEED }).tap();
    await expect(text).toHaveValue("Original thread draft");
    await page.screenshot({ path: test.info().outputPath("restored-draft.png") });
    expectCleanConsole();
  });

  test(`${engine.name()}: delayed thread snapshots never expose the previous composer`, async () => {
    const page = await start(engine);
    const text = page.getByRole("textbox", { name: "Message", exact: true });
    await text.fill("Private first draft");
    await page.getByRole("button", { name: "Threads", exact: true }).tap();
    const firstId = await page
      .locator("button[data-thread-id]")
      .first()
      .getAttribute("data-thread-id");
    await page.getByRole("button", { name: "New thread in mobile-project", exact: true }).tap();
    await expect(text).toHaveValue("");
    await text.fill("Private second draft");
    let proxy: WebSocketRoute | undefined;
    let held: (string | Buffer)[] = [];
    let hold = false;
    await page.routeWebSocket("**/socket", (route) => {
      proxy = route;
      const server = route.connectToServer();
      server.onMessage((data) => {
        if (hold) held.push(data);
        else route.send(data);
      });
      route.onMessage((data) => server.send(data));
    });
    await page.reload();
    await expect(text).toHaveValue("Private second draft");
    await page.getByRole("button", { name: "Threads", exact: true }).tap();
    hold = true;
    await page.locator(`button[data-thread-id="${firstId}"]`).tap();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await expect(text).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
    await expect(page.locator("header h1")).toHaveText(SEED);
    await page.screenshot({ path: test.info().outputPath("opening-thread.png") });
    hold = false;
    for (const message of held) proxy!.send(message);
    held = [];
    await expect(text).toHaveValue("Private first draft");
    expectCleanConsole();
  });

  test(`${engine.name()}: keyboard and offline notices keep the transcript and composer inside the viewport`, async () => {
    const page = await start(engine);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const size of [
        { width: 320, height: 568 },
        { width: 375, height: 667 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size);
        await expect
          .poll(() => page.locator(".remote-shell").evaluate((e) => e.clientHeight))
          .toBe(size.height);
        expect(await page.evaluate(() => document.body.scrollWidth)).toBe(size.width);
        const main = await page.locator("main").boundingBox();
        expect(main!.height).toBeGreaterThan(40);
        const sendBox = await page.getByRole("button", { name: "Send message" }).boundingBox();
        expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(size.height);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      // Finish the lazy highlighter's assets before deliberately taking the
      // network away; an interrupted import is not a layout regression.
      await expect
        .poll(() =>
          page.locator('[data-streamdown="code-block-body"] span').evaluateAll((spans) =>
            spans.some((span) => {
              const color = (span as HTMLElement).style.getPropertyValue("--sdm-c");
              return color !== "" && color !== "inherit";
            }),
          ),
        )
        .toBe(true);
      const text = page.getByRole("textbox", { name: "Message", exact: true });
      await text.fill("Keyboard and offline draft");
      await text.focus();
      await visualViewport(page, 350, 80);
      await page.context().setOffline(true);
      await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
      for (const height of [350, 240]) {
        await visualViewport(page, height, 80);
        const main = await page.locator("main").boundingBox();
        const footer = await page.locator("footer").boundingBox();
        expect(main!.height).toBeGreaterThan(40);
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(80 + height + 1);
        await page.locator("footer").evaluate((e) => {
          e.scrollTop = e.scrollHeight;
        });
        const sendBox = await page.getByRole("button", { name: "Send message" }).boundingBox();
        expect(sendBox!.y).toBeGreaterThanOrEqual(80);
        expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(80 + height + 1);
        const inputBox = await text.boundingBox();
        expect(inputBox!.y).toBeGreaterThanOrEqual(footer!.y);
        expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(80 + height + 1);
        expect(await page.locator("#root").evaluate((e) => e.scrollTop)).toBe(0);
      }
      await page.screenshot({
        path: test.info().outputPath(`keyboard-offline-${colorScheme}.png`),
        clip: { x: 0, y: 80, width: 390, height: 240 },
      });
      await visualViewport(page, null);
      await page.context().setOffline(false);
      await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeHidden();
      await expect(text).toHaveValue("Keyboard and offline draft");
    }
    expectCleanConsole();
  });
}

test("failed reconnects keep a single stable notice and allow choosing a destination offline", async () => {
  const page = await start(webkit);
  await page.setViewportSize({ width: 375, height: 667 });
  let proxy: WebSocketRoute | undefined;
  await page.routeWebSocket("**/socket", (route) => {
    proxy = route;
    const server = route.connectToServer();
    server.onMessage((data) => route.send(data));
    route.onMessage((data) => server.send(data));
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Threads", exact: true }).tap();
  const row = page.locator("button[data-thread-id]").first();
  const waiting: Route[] = [];
  await page.route("**/session", (route) => {
    waiting.push(route);
  });
  proxy!.close({ code: 1011, reason: "Temporary thread connection failure" });
  const reconnect = page.getByRole("button", { name: "Reconnect", exact: true });
  await expect(reconnect).toBeEnabled();
  const y = (await row.boundingBox())!.y;
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect.poll(() => waiting.length).toBe(cycle + 1);
    await expect(reconnect).toBeDisabled();
    expect((await row.boundingBox())!.y).toBe(y);
    await expect(row).toBeEnabled();
    await waiting[cycle]!.fulfill({ status: 503, body: "Temporary outage" });
    await expect(reconnect).toBeEnabled();
    expect((await row.boundingBox())!.y).toBe(y);
    await expect(page.locator(".remote-shell > section[role=status]")).toHaveCount(1);
    await expect(page.locator(".remote-shell > [role=alert]")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Error details", exact: true }).tap();
  await expect(page.getByRole("dialog", { name: "Connection details" })).toContainText(
    "Cannot reach your Mac",
  );
  await page.getByRole("button", { name: "Dismiss error", exact: true }).tap();
  expect((await row.boundingBox())!.y).toBe(y);
  await page.screenshot({ path: test.info().outputPath("stable-offline-thread-list.png") });
  await row.tap();
  await expect(page.getByRole("button", { name: "Threads", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
  await page.unroute("**/session");
  await reconnect.tap();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await expect(page.locator(".remote-shell > section[role=status]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("503"))).toEqual([]);
});

test("short-lived sockets retain retry backoff until a stable connection", async () => {
  const page = await start(webkit);
  let flapping = true;
  const attempts: number[] = [];
  await page.routeWebSocket("**/socket", (route) => {
    attempts.push(Date.now());
    const server = route.connectToServer();
    let closed = false;
    route.onMessage((data) => {
      if (!closed) server.send(data);
    });
    server.onMessage((data) => {
      if (closed) return;
      route.send(data);
      const message = JSON.parse(data.toString()) as { type: string };
      if (flapping && message.type === "sidebar") {
        closed = true;
        route.close({ code: 1011, reason: "Temporary thread connection failure" });
        server.close();
      }
    });
  });
  await page.reload();
  await expect.poll(() => attempts.length).toBeGreaterThanOrEqual(4);
  flapping = false;
  const intervals = attempts.slice(1, 4).map((time, i) => time - attempts[i]!);
  expect(intervals[1]).toBeGreaterThanOrEqual(900);
  expect(intervals[2]).toBeGreaterThanOrEqual(1900);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expectCleanConsole();
});

test("a local file link says it opens on the Mac without hanging or dropping the connection", async () => {
  const page = await start(webkit);
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.getByText("the notes", { exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "File preview" });
  await expect(dialog.getByRole("alert")).toHaveText(
    "This action is available only in Tondo on your Mac.",
  );
  await expect(dialog.getByText("Loading file…")).toHaveCount(0);
  await expect(page.locator(".remote-shell > [role=alert]")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("local-file-link.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  expect(sockets).toEqual([]);
  expectCleanConsole();
});

test("losing the connection during a read shows why, not a warning about sending", async () => {
  const page = await start(webkit);
  let proxy: WebSocketRoute | undefined;
  const reads = new Set<string>();
  let held = 0;
  await page.routeWebSocket("**/socket", (route) => {
    proxy = route;
    const server = route.connectToServer();
    route.onMessage((data) => {
      const { id, message } = JSON.parse(data.toString()) as {
        id: string;
        message: { type: string };
      };
      if (message.type === "list-checkpoints") reads.add(id);
      server.send(data);
    });
    server.onMessage((data) => {
      const message = JSON.parse(data.toString()) as { type: string; id?: string };
      // Hold the confirmation so the read is still pending when the connection drops.
      if (message.type === "remote-result" && reads.has(message.id!)) held++;
      else route.send(data);
    });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await page.getByRole("button", { name: "View changes", exact: true }).tap();
  await expect.poll(() => held).toBe(1);
  const waiting: Route[] = [];
  await page.route("**/session", (route) => {
    waiting.push(route);
  });
  proxy!.close({ code: 1011, reason: "Temporary thread connection failure" });
  // While the reconnect waits, the notice gives the real reason.
  await expect.poll(() => waiting.length).toBe(1);
  const status = page.locator(".remote-shell > section[role=status]");
  await expect(status).toContainText("Temporary thread connection failure");
  await expect(status).not.toContainText("Connection lost before confirmation");
  await waiting[0]!.continue();
  await page.unroute("**/session");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(status).toHaveCount(0);
  expectCleanConsole();
});

test("fullscreen table controls are finger-sized and horizontally scrollable", async () => {
  const page = await start(webkit);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole("button", { name: "View fullscreen", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "View fullscreen", exact: true });
  await expect(dialog).toBeVisible();
  for (const name of ["Copy table", "Download table", "Exit fullscreen"]) {
    const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
  const scrolling = dialog.locator(".overflow-auto");
  expect(await scrolling.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await scrolling.evaluate((e) => {
    e.scrollLeft = 200;
  });
  expect(await scrolling.evaluate((e) => e.scrollLeft)).toBe(200);
  await page.screenshot({ path: test.info().outputPath("touch-table-controls.png") });
  await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).tap();
  await expect(dialog).toBeHidden();
  expectCleanConsole();
});
