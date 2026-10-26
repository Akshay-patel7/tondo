import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiMessage, AssistantMessage } from "../src/shared/thread";
import { IMAGE_FIXTURE } from "../src/shared/imageFixture";
import { bringToFront, captureOpenExternal, type Tondo } from "./launch";
import { addProject, launchWithPi, reply, waitForPi } from "./pi";
import { writeSessions } from "./sessions";

let dir: string;
let project: string;
let tondo: Tondo | undefined;
let errors: string[];

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-output-")));
  project = path.join(dir, "project");
  mkdirSync(project);
  errors = [];
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: { ...usage, totalTokens: 0, cost: { ...usage, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
const text = (value: string) => ({ type: "text" as const, text: value });

async function start(messages: PiMessage[], theme: "light" | "dark" = "dark") {
  const [session] = writeSessions(path.join(dir, "seed"), project, 1);
  const [header] = readFileSync(session!.file, "utf8").trim().split("\n");
  let parentId: string | null = null;
  const entries = [
    { role: "user", content: "Output parity", timestamp: Date.now() - 1000 },
    ...messages,
  ].map((message, index) => {
    const id = String(index).padStart(8, "0");
    const entry = {
      type: "message",
      id,
      parentId,
      timestamp: new Date(message.timestamp).toISOString(),
      message,
    };
    parentId = id;
    return JSON.stringify(entry);
  });
  writeFileSync(session!.file, [header, ...entries, ""].join("\n"));
  tondo = await launchWithPi({
    workDir: dir,
    settings: { theme },
    script: { responses: [reply("Ready.")] },
    piArgs: ["--fork", session!.file],
  });
  tondo.page.on("pageerror", (error) => errors.push(error.message));
  await bringToFront(tondo);
  await tondo.page.emulateMedia({ colorScheme: null });
  await expect
    .poll(() => tondo!.page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
    .toBe(theme === "dark");
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  return tondo;
}

for (const theme of ["dark", "light"] as const) {
  test.describe(theme, () => {
    test("local links preview current files on click, refuse escapes, and keep external links safe", async () => {
      const { page, app } = await start(
        [
          assistant([
            text(
              "[Dark preview](test-results/history-dark.png) · [Performance report](.dev/perf/report.md) · [Missing](missing.md) · [Outside](../secret.txt) · [Web](https://example.com/report)",
            ),
          ]),
        ],
        theme,
      );
      const opened = await captureOpenExternal(app);
      const report = page.getByRole("button", { name: "Performance report", exact: true });
      await expect(report).toBeVisible();
      await expect(page.getByText("[blocked]", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Created after the transcript rendered: the preview must read on activation, not preload.
      mkdirSync(path.join(project, ".dev/perf"), { recursive: true });
      writeFileSync(
        path.join(project, ".dev/perf/report.md"),
        "# Performance report\nFrame p95: 9.3 ms",
      );
      mkdirSync(path.join(project, "test-results"));
      writeFileSync(
        path.join(project, "test-results/history-dark.png"),
        Buffer.from(IMAGE_FIXTURE.data, "base64"),
      );
      writeFileSync(path.join(dir, "secret.txt"), "Never show this");
      const preview = page.getByRole("dialog", { name: "File preview", exact: true });
      await report.click();
      await expect(preview.getByRole("region", { name: "File contents" })).toContainText(
        "Frame p95: 9.3 ms",
      );
      await page.screenshot({
        path: test.info().outputPath("report.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(preview).not.toBeAttached();
      await expect(report).toBeFocused();
      await page.getByRole("button", { name: "Dark preview", exact: true }).click();
      await expect
        .poll(() =>
          preview.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBe(2);
      await preview.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Missing", exact: true }).click();
      await expect(preview.getByRole("alert")).toContainText("ENOENT");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Outside", exact: true }).click();
      await expect(preview.getByRole("alert")).toHaveText(
        "File previews stay inside this thread's checkout.",
      );
      await expect(preview).not.toContainText("Never show this");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Web", exact: true }).click();
      const external = page.getByRole("dialog", { name: "Open external link?" });
      await external.getByRole("button", { name: "Open link", exact: true }).click();
      expect(await opened()).toBe("https://example.com/report");
      expect(page.url()).toMatch(/^tondo:/);

      await page.reload();
      await expect(report).toBeVisible();
      await report.click();
      await expect(preview.getByRole("region", { name: "File contents" })).toContainText(
        "Frame p95: 9.3 ms",
      );
    });

    test("tool images decode only after expansion, four at a time, and release URLs on collapse", async () => {
      const { page } = await start(
        [
          assistant([
            {
              type: "toolCall",
              id: "screenshot",
              name: "read",
              arguments: { path: "preview.png" },
            },
          ]),
          {
            role: "toolResult",
            toolCallId: "screenshot",
            toolName: "read",
            timestamp: Date.now(),
            isError: false,
            content: [
              text("Screenshots"),
              ...Array.from({ length: 5 }, () => ({
                type: "image" as const,
                mimeType: IMAGE_FIXTURE.mimeType,
                data: IMAGE_FIXTURE.data,
              })),
            ],
          },
          assistant([text("Images ready.")]),
        ],
        theme,
      );
      const row = page.locator('[data-tool-call="screenshot"]');
      await expect(row).toBeVisible();
      await expect(row.locator("img")).toHaveCount(0);
      await page.evaluate(() => {
        const original = URL.revokeObjectURL.bind(URL);
        Object.assign(window, { revokedImageUrls: 0 });
        URL.revokeObjectURL = (url) => {
          (window as unknown as { revokedImageUrls: number }).revokedImageUrls++;
          original(url);
        };
      });
      await row.getByRole("button").first().click();
      await expect(row.locator("img")).toHaveCount(4);
      await expect(row).not.toContainText("[image:");
      await expect
        .poll(() =>
          row
            .locator("img")
            .evaluateAll((imgs) =>
              imgs.every((img) => (img as HTMLImageElement).naturalWidth === 2),
            ),
        )
        .toBe(true);
      await row.getByRole("button", { name: "Show more images" }).click();
      await expect(row.locator("img")).toHaveCount(5);
      await row.getByRole("button", { name: "Preview Result image 1", exact: true }).click();
      const imageDialog = page.getByRole("dialog", {
        name: "Image preview: Result image 1",
        exact: true,
      });
      await expect(imageDialog).toBeVisible();
      await expect(imageDialog).toHaveCSS("opacity", "1");
      await expect
        .poll(() =>
          imageDialog.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBe(2);
      await page.screenshot({
        path: test.info().outputPath("tool-image.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await row.getByRole("button").first().click();
      await expect(row.locator("img")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { revokedImageUrls: number }).revokedImageUrls),
        )
        .toBeGreaterThanOrEqual(6);
    });

    test("extension messages, direct shell history and summaries survive reload with lazy disclosure", async () => {
      const now = Date.now();
      const { page } = await start(
        [
          {
            role: "custom",
            customType: "notice",
            display: true,
            content: "Visible extension message",
            timestamp: now,
          },
          {
            role: "custom",
            customType: "hidden",
            display: false,
            content: "Private extension context",
            timestamp: now,
          },
          {
            role: "bashExecution",
            command: "printf shell-output",
            output: "shell-output",
            exitCode: 0,
            cancelled: false,
            truncated: false,
            timestamp: now,
          },
          {
            role: "compactionSummary",
            summary: "Preserved compaction context",
            tokensBefore: 1000,
            timestamp: now,
          },
          {
            role: "branchSummary",
            summary: "Preserved branch context",
            fromId: null,
            timestamp: now,
          },
        ],
        theme,
      );
      await expect(page.getByRole("article", { name: "Extension: notice" })).toContainText(
        "Visible extension message",
      );
      await expect(page.getByText("Private extension context", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Preserved compaction context", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Shell execution", exact: true }).click();
      await expect(page.getByRole("region", { name: "Output", exact: true })).toHaveText(
        "shell-output",
      );
      await page.getByRole("button", { name: "Compaction summary", exact: true }).click();
      await expect(page.getByText("Preserved compaction context", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Branch summary", exact: true }).click();
      await expect(page.getByText("Preserved branch context", { exact: true })).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath("context.png"),
        animations: "disabled",
      });
      await page.reload();
      await expect(page.getByRole("article", { name: "Extension: notice" })).toContainText(
        "Visible extension message",
      );
      await page.getByRole("button", { name: "Compaction summary", exact: true }).click();
      await expect(page.getByText("Preserved compaction context", { exact: true })).toBeVisible();
    });
  });
}
