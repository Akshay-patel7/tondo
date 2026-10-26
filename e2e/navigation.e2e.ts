import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PiMessage } from "../src/shared/thread";
import { longReply, send, waitForIdle } from "./pi";
import {
  gapToEnd,
  launchOnTranscript,
  openTranscript,
  newTranscriptThread,
  waitForReply,
  type TranscriptTondo,
} from "./timeline";

const { messages } = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/transcript-1000.json"), "utf8"),
) as { messages: PiMessage[] };
const prompts = messages
  .filter((message) => message.role !== "system")
  .flatMap((message, index) => (message.role === "user" ? [index] : []));

let tondo: TranscriptTondo;
test.beforeEach(async () => {
  tondo = await launchOnTranscript({ script: { tokensPerSecond: 1000, responses: [longReply()] } });
  await openTranscript(tondo);
});
test.afterEach(() => tondo.close());

async function expectAtMessage(index: number) {
  const { page } = tondo;
  const row = page.locator(`[data-index="${index}"]`);
  await expect(row).toBeInViewport();
  await expect
    .poll(() =>
      row.evaluate((node) => {
        const viewport = node.closest('[aria-label="Transcript"]')!;
        return Math.abs(node.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
      }),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "false");
  await expect(page.getByRole("region", { name: "Transcript", exact: true })).toBeFocused();
}

test("keyboard previews and jumps reach prompts beyond the capped ticks", async () => {
  const { page } = tondo;
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await expect(page.locator("[data-history-tick]")).toHaveCount(40);
  await expect(page.getByRole("tooltip")).not.toBeAttached();
  await navigator.focus();
  await navigator.press("Home");
  await expect(page.getByRole("tooltip")).toContainText(`Message 1 of ${prompts.length}`);
  await navigator.press("Enter");
  await expectAtMessage(0);
  await navigator.focus();
  await navigator.press("Home");
  // Each gesture depends on the selection from the previous key.
  // eslint-disable-next-line no-await-in-loop
  for (let index = 0; index < 55; index++) await navigator.press("ArrowDown");
  await expect(page.getByRole("tooltip")).toContainText(`Message 56 of ${prompts.length}`);
  await navigator.press("Enter");
  await expectAtMessage(prompts[55]!);
  await expect.poll(() => page.locator("[data-virtual-row]").count()).toBeLessThan(20);
  await page.getByRole("region", { name: "Transcript", exact: true }).press("PageDown");
  await expect
    .poll(() =>
      page.evaluate((index) => {
        const row = document.querySelector(`[data-index="${index}"]`);
        const viewport = document.querySelector('[aria-label="Transcript"]')!;
        return !row || row.getBoundingClientRect().top < viewport.getBoundingClientRect().top - 1;
      }, prompts[55]!),
    )
    .toBe(true);
  await navigator.focus();
  await navigator.press("End");
  await expect(page.getByRole("tooltip")).toContainText(
    `Message ${prompts.length} of ${prompts.length}`,
  );
  await navigator.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeAttached();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);
  await newTranscriptThread(tondo);
  await expect(page.getByRole("tooltip")).not.toBeAttached();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "true");
});

test("pointer preview stays lazy, clicks land on unmounted history, and both themes fit", async () => {
  const { page } = tondo;
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await navigator.hover({ position: { x: 12, y: 120 } });
  const preview = page.getByRole("tooltip");
  await expect(preview).toContainText(
    `Message ${Math.round((prompts.length - 1) / 2) + 1} of ${prompts.length}`,
  );
  await expect(preview.locator("p").nth(1)).not.toBeEmpty();
  await expect(preview.locator("p").nth(2)).not.toBeEmpty();
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: test.info().outputPath("history-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("history-dark.png") });
  await navigator.click({ position: { x: 12, y: 120 } });
  await expectAtMessage(prompts[Math.round((prompts.length - 1) / 2)]!);
  await page.getByRole("region", { name: "Transcript", exact: true }).hover();
  await expect(preview).not.toBeAttached();
});

test("streaming does not mutate an idle navigator and a history jump stays anchored", async () => {
  test.setTimeout(60_000);
  const { page } = tondo;
  await send(page, "Walk me through the parser rewrite, with code.");
  await waitForReply(page, 1000);
  const observation = await page
    .getByRole("navigation", { name: "Message history" })
    .evaluateHandle((nav) => {
      const state = { changes: 0 };
      const observer = new MutationObserver((records) => {
        state.changes += records.length;
      });
      observer.observe(nav, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      return { state, observer };
    });
  await waitForReply(page, 4000);
  expect(
    await observation.evaluate(({ state, observer }) => {
      observer.disconnect();
      return state.changes;
    }),
  ).toBe(0);
  await observation.dispose();
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await navigator.focus();
  await navigator.press("Home");
  await navigator.press("ArrowDown");
  await navigator.press("Enter");
  await expectAtMessage(prompts[1]!);
  await waitForIdle(page, { timeout: 45_000 });
  await expectAtMessage(prompts[1]!);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "true");
  await expect.poll(() => gapToEnd(page)).toBeLessThanOrEqual(1);
});
