// What the page shows when a process dies or the page reloads mid-stream.
// Main restarts the host or reloads the page and hands the page a new port,
// and the host answers every new port with the thread as it stands.
import { expect, test, type Page } from "@playwright/test";
import { bringToFront, hostPid, launchTondo, type Tondo } from "./launch";
import { LAST_TRANSCRIPT_ROW, play, waitForReply, waitForTranscript } from "./timeline";

/** Interrupt the stream once the reply is this long, about a quarter of it. */
const INTERRUPT_AT_CHARS = 20_000;

let tondo: Tondo;

test.beforeEach(async () => {
  tondo = await launchTondo();
  await bringToFront(tondo);
  await waitForTranscript(tondo.page);
});

test.afterEach(async () => {
  await tondo.close();
});

test("the page reconnects when the host dies mid-stream", async () => {
  const { app, page } = tondo;
  await play(page, "stream-1000");
  await waitForReply(page, 1);
  const statuses = await recordStatuses(page);
  const killed = await hostPid(app);
  process.kill(killed, "SIGKILL");

  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "idle");
  expect(await statuses.evaluate((seen) => seen)).toEqual([
    { status: "reconnecting", notice: "Reconnecting…" },
    { status: "idle", notice: null },
  ]);
  expect(await hostPid(app)).not.toBe(killed);
  // The new host opened the transcript afresh. The reply died with the old one.
  await expect(page.locator(`[data-index="${LAST_TRANSCRIPT_ROW}"]`)).toBeInViewport();
  await expect(page.locator(`[data-index="${LAST_TRANSCRIPT_ROW + 1}"]`)).not.toBeAttached();

  // The new port carries messages both ways.
  await play(page, "stream-1000");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "idle");
});

test("a reloaded page picks the stream up where it is", async () => {
  const { page } = tondo;
  await play(page, "stream-1000");
  await waitForReply(page, INTERRUPT_AT_CHARS);

  await page.reload();
  // The reply is back as soon as it shows, so it came with the host's snapshot.
  const reply = page.locator("[data-streaming]");
  await expect(reply).toBeAttached();
  expect(await reply.evaluate((row) => row.textContent?.length ?? 0)).toBeGreaterThanOrEqual(
    INTERRUPT_AT_CHARS,
  );
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "playing");

  // The page builds the rest of the reply from batches. Stop freezes the
  // thread mid-reply, before pi's final message could cover a lost batch.
  await waitForReply(page, 2 * INTERRUPT_AT_CHARS);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "idle");
  // Batches that arrived before the stop show on the next frame.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  // What the page built has to match the host's copy, which Reopen sends whole.
  const streamed = await lastRow(page);
  const timeline = await page.getByTestId("timeline").elementHandle();
  await page.getByRole("button", { name: "Reopen" }).click();
  // The reopened thread mounts a new timeline. Code blocks highlight after it mounts.
  await timeline?.waitForElementState("hidden");
  await expect.poll(() => lastRow(page)).toEqual(streamed);
});

test("the page comes back after its renderer crashes", async () => {
  const { app, page } = tondo;
  await play(page, "stream-1000");

  // Main waits for the reply, crashes the renderer and reads the reloaded
  // page, so Playwright stays off the page. Playwright gives up on a page
  // whose renderer crashed. And if the renderer dies while a Playwright
  // command to the page is in flight, Chromium answers that command after
  // reporting the crash, and Playwright 1.63 throws on the answer, failing
  // the test. page.waitForFunction leaves one in flight as it returns.
  const replyLength = await app.evaluate(async ({ BrowserWindow }, chars) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    // Resolves with the reply's length once the player is playing and the
    // reply has at least `min` characters.
    const replyAtLeast = (min: number) =>
      contents.executeJavaScript(`new Promise((resolve) => {
        const check = () => {
          const status = document.querySelector("[data-testid=player]")?.dataset.status;
          const reply = document.querySelector("[data-streaming]");
          if (status === "playing" && reply && reply.textContent.length >= ${min}) {
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
    return replyAtLeast(0);
  }, INTERRUPT_AT_CHARS);
  // As with a reload, the reply came back whole with the host's snapshot.
  expect(replyLength).toBeGreaterThanOrEqual(INTERRUPT_AT_CHARS);
});

/**
 * Records each status the player controls show from now on, with the notice
 * beside it. It watches the DOM, so it catches states too brief to poll for.
 */
function recordStatuses(page: Page) {
  return page.evaluateHandle(() => {
    const player = document.querySelector<HTMLElement>("[data-testid=player]");
    if (!player) throw new Error("The player controls aren't on the page");
    const seen: { status: string | undefined; notice: string | null }[] = [];
    new MutationObserver(() => {
      seen.push({
        status: player.dataset.status,
        notice: player.querySelector("[role=status]")?.textContent ?? null,
      });
    }).observe(player, { attributeFilter: ["data-status"] });
    return seen;
  });
}

/** The timeline's last row, which is rendered while the timeline follows the end. */
function lastRow(page: Page): Promise<{ index: number; text: string | null }> {
  return page.locator("[data-index]").evaluateAll((rows) => {
    let index = -1;
    let text: string | null = null;
    for (const row of rows) {
      const rowIndex = Number(row.getAttribute("data-index"));
      if (rowIndex > index) {
        index = rowIndex;
        text = row.textContent;
      }
    }
    return { index, text };
  });
}
