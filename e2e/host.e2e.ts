// What the page shows when a process dies or the page reloads mid-stream.
// Main restarts the host or reloads the page and hands the page a new port,
// and the host answers every new port with what it has.
import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, hostPid, type Tondo } from "./launch";
import {
  addProject,
  launchWithPi,
  recordStatuses,
  reply,
  send,
  waitForIdle,
  waitForPi,
  words,
} from "./pi";
import { waitForReply } from "./timeline";

/** Plain words, so every piece of the reply the page shows is the start of the whole. */
const ANSWER = words(4000);
/** The reply's 35,000 characters stream for about 17 s. */
const TOKENS_PER_SECOND = 500;
/** Interrupt the stream once the reply is this long. */
const INTERRUPT_AT_CHARS = 5_000;

test.describe.configure({ timeout: 90_000 });

let workDir: string;
let project: string;
let tondo: Tondo;

test.beforeEach(async () => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-host-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
  tondo = await launchWithPi({
    workDir,
    script: { tokensPerSecond: TOKENS_PER_SECOND, responses: [reply(ANSWER)] },
  });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, "Say something long.");
});

test.afterEach(async () => {
  await tondo.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("the page reconnects when the host dies mid-stream, and the thread comes back", async () => {
  const { app, page } = tondo;
  await waitForReply(page, 1);
  const statuses = await recordStatuses(page);
  const killed = await hostPid(app);
  process.kill(killed, "SIGKILL");

  await expect.poll(() => statuses.jsonValue()).toEqual(["Reconnecting…"]);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await hostPid(app)).not.toBe(killed);

  // The new host reopens the thread from Tondo's store. pi saves a session
  // once its first reply ends, so the new pi starts the thread empty.
  await expect(page.locator("[data-streaming]")).toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("listitem")).toHaveCount(1);
  await expect(page.locator("nav [aria-current=page]")).toHaveCount(1);

  // The new port carries messages both ways. The new pi starts the faux script again.
  await waitForPi(page);
  await send(page, "Say it again.");
  await waitForReply(page, 1);
});

test("a reloaded page picks the stream up where it is", async () => {
  const { page } = tondo;
  await waitForReply(page, INTERRUPT_AT_CHARS);

  // Records each text the reply shows in the reloaded page, from its first render.
  await page.addInitScript(() => {
    const texts: string[] = [];
    Object.assign(window, { tondoReplyTexts: texts });
    new MutationObserver(() => {
      const text = document.querySelector("[data-streaming]")?.textContent?.trim();
      if (text && text !== texts.at(-1)) texts.push(text);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.reload();
  await expect(page.locator("[data-streaming]")).toBeAttached();
  await waitForIdle(page, { timeout: 60_000 });

  const texts = await page.evaluate(
    () => (window as typeof window & { tondoReplyTexts: string[] }).tondoReplyTexts,
  );
  // The first text came whole with the host's snapshot. The page built the
  // rest from batches, and lost none: each text is the start of pi's reply.
  expect(texts[0]?.length).toBeGreaterThanOrEqual(INTERRUPT_AT_CHARS);
  expect(texts.length).toBeGreaterThan(10);
  expect(texts.filter((text) => !ANSWER.startsWith(text))).toEqual([]);
  await expect(page.locator('[data-index="1"]')).toHaveText(ANSWER);
});

test("the page comes back after its renderer crashes", async () => {
  const { app } = tondo;

  // Main waits for the reply, crashes the renderer and reads the reloaded
  // page, so Playwright stays off the page. Playwright gives up on a page
  // whose renderer crashed. And if the renderer dies while a Playwright
  // command to the page is in flight, Chromium answers that command after
  // reporting the crash, and Playwright 1.63 throws on the answer, failing
  // the test. page.waitForFunction leaves one in flight as it returns.
  const replyLength = await app.evaluate(async ({ BrowserWindow }, chars) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    // Resolves with the length of the reply, streaming or done, once it has
    // at least `min` characters.
    const replyAtLeast = (min: number) =>
      contents.executeJavaScript(`new Promise((resolve) => {
        const check = () => {
          const reply = document.querySelector('[data-index="1"]');
          if (reply && reply.textContent.length >= ${min}) {
            resolve(reply.textContent.length);
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      })`) as Promise<number>;

    await replyAtLeast(chars);
    const reloaded = new Promise<void>((resolve) => contents.once("dom-ready", () => resolve()));
    contents.forcefullyCrashRenderer();
    await reloaded;
    return replyAtLeast(1);
  }, INTERRUPT_AT_CHARS);
  // As with a reload, the reply came back whole with the host's snapshot.
  expect(replyLength).toBeGreaterThanOrEqual(INTERRUPT_AT_CHARS);
});
