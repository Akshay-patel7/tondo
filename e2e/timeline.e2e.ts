import { expect, test } from "@playwright/test";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  FOLLOW_THRESHOLD_PX,
  LAST_TRANSCRIPT_ROW,
  gapToEnd,
  play,
  waitForPlayback,
  waitForTranscript,
} from "./timeline";

// The 1,000 tokens per second reply streams for 23 s.
const PLAYBACK_TIMEOUT = 60_000;

let tondo: Tondo;

test.beforeEach(async () => {
  tondo = await launchTondo();
  await bringToFront(tondo);
  await waitForTranscript(tondo.page);
});

test.afterEach(async () => {
  await tondo.close();
});

test("the transcript opens at the bottom", async () => {
  const { page } = tondo;
  await expect(page.locator(`[data-index="${LAST_TRANSCRIPT_ROW}"]`)).toBeInViewport();
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "true");
});

test("the timeline stays at the bottom while pi streams", async () => {
  test.setTimeout(PLAYBACK_TIMEOUT + 30_000);
  const { page } = tondo;

  // Legend List scrolls to the end in the frame after a row grows or arrives,
  // so a frame can end a few hundred pixels short of the end. How long the view
  // trails depends on the machine, so `pnpm perf` holds that to its budget.
  // This test checks what holds on any machine, after each frame paints until
  // the player finishes: the timeline keeps following, and the view never moves
  // back up the list, as it did for a frame when a new row made Legend List
  // re-estimate the rows above.
  const sampler = await page.evaluateHandle((threshold) => {
    const timeline = document.querySelector<HTMLElement>("[data-testid=timeline]");
    const scroller = timeline?.firstElementChild;
    const player = document.querySelector<HTMLElement>("[data-testid=player]");
    if (!timeline || !scroller || !player) throw new Error("The timeline or the player is missing");

    const result = {
      frames: 0,
      behind: 0,
      largestGap: 0,
      movedBack: 0,
      unfollowed: 0,
    };
    let lastRowOnScreen = -1;

    const sample = () => {
      const view = scroller.getBoundingClientRect();
      let lastRow = -1;
      for (const row of scroller.querySelectorAll<HTMLElement>("[data-index]")) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > view.top && rect.top < view.bottom) {
          lastRow = Math.max(lastRow, Number(row.dataset.index));
        }
      }
      if (lastRow < lastRowOnScreen) result.movedBack++;
      lastRowOnScreen = Math.max(lastRowOnScreen, lastRow);

      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      result.frames++;
      result.largestGap = Math.max(result.largestGap, gap);
      if (gap > threshold) result.behind++;
      if (timeline.dataset.following !== "true") result.unfollowed++;
    };

    let started = false;
    const done = new Promise<typeof result>((resolve) => {
      const onFrame = () => {
        const status = player.dataset.status;
        if (status === "playing") started = true;
        if (started && status === "idle") {
          resolve(result);
          return;
        }
        if (started) setTimeout(sample);
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
    });
    return { done };
  }, FOLLOW_THRESHOLD_PX);

  await play(page, "stream-1000");
  await waitForPlayback(page, PLAYBACK_TIMEOUT);
  const result = await sampler.evaluate(({ done }) => done);

  test.info().annotations.push({
    type: "distance from the end after each frame",
    description:
      `${result.frames} frames, ${result.behind} more than ${FOLLOW_THRESHOLD_PX} px short, ` +
      `largest ${result.largestGap} px`,
  });
  expect(result.frames).toBeGreaterThan(100);
  expect(result.unfollowed).toBe(0);
  expect(result.movedBack).toBe(0);
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);
});

test("the timeline holds its position while you read history", async () => {
  test.setTimeout(PLAYBACK_TIMEOUT + 30_000);
  const { page } = tondo;
  const timeline = page.getByTestId("timeline");

  await play(page, "stream-1000");
  await expect(page.locator("[data-streaming]")).toBeAttached();

  const scroll = await page.evaluateHandle(() => {
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!scroller) throw new Error("The timeline isn't on the page");
    return {
      ended: new Promise<void>((resolve) => {
        scroller.addEventListener("scrollend", () => resolve(), { once: true });
      }),
    };
  });
  await timeline.hover();
  await page.mouse.wheel(0, -1500);
  await scroll.evaluate(({ ended }) => ended);
  await expect(timeline).toHaveAttribute("data-following", "false");

  // Note where the row in the middle of the view sits.
  const anchor = await page.evaluate(() => {
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!scroller) throw new Error("The timeline isn't on the page");
    const view = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(view.left + view.width / 2, view.top + view.height / 2);
    const row = hit?.closest<HTMLElement>("[data-index]");
    if (!row?.dataset.index) throw new Error("No row in the middle of the timeline");
    return { index: row.dataset.index, top: row.getBoundingClientRect().top };
  });

  await waitForPlayback(page, PLAYBACK_TIMEOUT);

  const top = await page
    .locator(`[data-index="${anchor.index}"]`)
    .evaluate((row) => row.getBoundingClientRect().top);
  expect(Math.abs(top - anchor.top)).toBeLessThanOrEqual(1);
  await expect(timeline).toHaveAttribute("data-following", "false");
});
