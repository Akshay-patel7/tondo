import { expect, type Page } from "@playwright/test";
import type { FixtureName } from "../src/renderer/player/protocol";

/**
 * transcript-1000.json holds pi's system prompt and 1,000 messages. The
 * timeline doesn't show the system prompt, so its rows are 0 to 999.
 */
export const LAST_TRANSCRIPT_ROW = 999;

/** The follow threshold in src/renderer/timeline/follow.ts. */
export const FOLLOW_THRESHOLD_PX = 40;

/** Waits until the fixture player has opened the transcript. */
export async function waitForTranscript(page: Page): Promise<void> {
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "idle");
}

/** Starts replaying a fixture with the player controls, at the recorded pace. */
export async function play(page: Page, fixture: FixtureName): Promise<void> {
  await page.getByLabel("Fixture").selectOption(fixture);
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "playing");
}

/** Waits until the player has replayed the whole fixture. */
export async function waitForPlayback(page: Page, timeout: number): Promise<void> {
  await expect(page.getByTestId("player")).toHaveAttribute("data-status", "idle", { timeout });
}

/** Pixels of content below the bottom of the timeline's viewport. */
export function gapToEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Legend List's scroll element is the timeline's only child.
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!scroller) throw new Error("The timeline isn't on the page");
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  });
}
