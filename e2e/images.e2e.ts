import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import type { UserMessage } from "@earendil-works/pi-ai";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IMAGE_FIXTURE } from "../src/shared/imageFixture";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
} from "./pi";

let workDir: string;
let project: string;
let tondo: Tondo | undefined;
let errors: string[];
const fixture = {
  name: IMAGE_FIXTURE.name,
  mimeType: IMAGE_FIXTURE.mimeType,
  buffer: Buffer.from(IMAGE_FIXTURE.data, "base64"),
};
const piArgs = ["-e", path.resolve(__dirname, "../scripts/fixtures/image-ext.ts")];

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-images-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
  errors = [];
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});
function recordErrors(page: Page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}
async function start(slow = false): Promise<Page> {
  tondo = await launchWithPi({
    workDir,
    piArgs,
    script: {
      recordInputs: path.join(workDir, "provider-input.json"),
      responses: [reply(slow ? "word ".repeat(20_000) : "Saw the image."), reply("Second image.")],
      ...(slow ? { tokensPerSecond: 200 } : {}),
    },
  });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  return tondo.page;
}
const attachments = (page: Page) => page.getByLabel("Attached images", { exact: true });
async function pickImage(page: Page) {
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images", exact: true }).click();
  await (await choosing).setFiles(fixture);
  await expect(
    attachments(page).getByRole("button", { name: `Preview ${fixture.name}`, exact: true }),
  ).toBeVisible();
}
async function decoded(page: Page) {
  await expect
    .poll(() =>
      attachments(page)
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth === 2,
          ),
        ),
    )
    .toBe(true);
}

test("paste a real clipboard image, preview it, and send its pixels to pi", async () => {
  const page = await start();
  await tondo!.app.evaluate(
    ({ clipboard, ClipboardItem }, data) =>
      clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([Buffer.from(data, "base64")], { type: "image/png" }),
        }),
      ]),
    IMAGE_FIXTURE.data,
  );
  await composer(page).fill("Keep **Markdown**");
  await page.keyboard.press("ControlOrMeta+v");
  await expectDraft(page, "Keep **Markdown**");
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await decoded(page);
  await attachments(page)
    .getByRole("button", { name: /^Preview / })
    .click();
  await expect(page.getByRole("dialog", { name: /^Image preview:/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("preview.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await composer(page).fill("What is in this image?");
  await page.screenshot({ path: test.info().outputPath("attached.png"), animations: "disabled" });
  await composer(page).press("Enter");
  await expect(attachments(page)).toBeHidden();
  await expect(page.getByText("Saw the image.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  const sent = page.locator('[data-index="0"]');
  await expect(sent.getByRole("button", { name: "Preview Image 1", exact: true })).toBeVisible();
  await expect
    .poll(() => sent.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(2);
  // This file is written inside the faux response factory, after pi has normalized
  // the prompt for the provider. Check the pasted pixels, not just the transcript.
  const recorded = JSON.parse(
    readFileSync(path.join(workDir, "provider-input.json"), "utf8"),
  ) as UserMessage[];
  const content = recorded[0]!.content;
  if (typeof content === "string") throw new Error("The provider received no image blocks");
  const received = content.filter((part) => part.type === "image");
  expect(received).toHaveLength(1);
  const pixels = await page.evaluate(async (image) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0))], {
        type: image.mimeType,
      }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      rgba: [...ctx.getImageData(0, 0, 1, 1).data],
    };
    bitmap.close();
    return result;
  }, received[0]!);
  expect(pixels).toEqual({ width: 2, height: 2, rgba: [180, 80, 50, 255] });
  await expect(threadRows(page).first()).toHaveAttribute("title", "What is in this image?");
  await page.screenshot({ path: test.info().outputPath("sent.png"), animations: "disabled" });
});

test("drop, remove and reject unsupported or oversized images", async () => {
  const page = await start();
  const transfer = await page.evaluateHandle((image) => {
    const data = new DataTransfer();
    data.items.add(
      new File([Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0))], image.name, {
        type: image.mimeType,
      }),
    );
    return data;
  }, IMAGE_FIXTURE);
  try {
    await composer(page).dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await decoded(page);
  await attachments(page)
    .getByRole("button", { name: `Remove ${fixture.name}`, exact: true })
    .click();
  await expect(attachments(page)).toBeHidden();
  await page.getByLabel("Choose images", { exact: true }).setInputFiles({
    name: "no.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByText("Use PNG, JPEG, GIF or WebP images.", { exact: true })).toBeVisible();
  await page
    .getByLabel("Choose images", { exact: true })
    .setInputFiles({ ...fixture, buffer: Buffer.alloc(6 * 1024 * 1024) });
  await expect(
    page.getByText("Each image must be 5 MiB or smaller.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Choose images", { exact: true })
    .setInputFiles({ ...fixture, buffer: Buffer.from("broken") });
  await expect(page.getByText(`Couldn't decode ${fixture.name}.`, { exact: true })).toBeVisible();
  await expect(attachments(page)).toBeHidden();
});

test("images wait while pi works, and image-only sends work after stopping", async () => {
  const page = await start(true);
  await send(page, "Work.");
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();
  await pickImage(page);
  await expect(
    page.getByText("Images stay in your draft until pi finishes. Only text can be queued."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await composer(page).press("Alt+Enter");
  await composer(page).press("Enter");
  await expect(page.getByLabel("Queued messages")).toBeHidden();
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await composer(page).press("Escape");
  await waitForIdle(page);
  await composer(page).press("Enter");
  await expect(attachments(page)).toBeHidden();
  await expect(page.getByText("Second image.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await expect(page.getByRole("button", { name: "Preview Image 1", exact: true })).toBeVisible();
});

test("local and extension commands keep images, and a pi exit before acknowledgement recovers the draft", async () => {
  const page = await start();
  await pickImage(page);
  await send(page, "/session");
  const sheet = page.getByRole("dialog", { name: "Session", exact: true });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await send(page, "/tondo-image-noop");
  await expect(page.getByText("Command ran; images stay local", { exact: true })).toBeVisible();
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await send(page, "Exit before image acknowledgement.");
  await expect(page.getByRole("button", { name: "Restart pi" })).toBeVisible();
  await expectDraft(page, "Exit before image acknowledgement.");
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Restart pi" }).click();
  await waitForPi(page);
  await send(page, "Recovered.");
  await expect(attachments(page)).toBeHidden();
  await expect(page.getByText("Saw the image.", { exact: true })).toBeVisible();
});

test("an image-only draft survives switching threads and restarting the app", async () => {
  const profileDir = path.join(workDir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({ workDir, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  const page = tondo.page;
  await waitForPi(page);
  await pickImage(page);
  await page.keyboard.press("ControlOrMeta+n");
  await expect(attachments(page)).toBeHidden();
  await expect(threadRows(page)).toHaveCount(2);
  await page.getByRole("img", { name: "Unsent draft" }).click();
  await expect(attachments(page).locator("img")).toHaveCount(1);
  await expect
    .poll(() => {
      const db = new DatabaseSync(path.join(profileDir, "tondo.sqlite"), { readOnly: true });
      try {
        return (db.prepare("SELECT count(*) AS n FROM draft_images").get() as { n: number }).n;
      } finally {
        db.close();
      }
    })
    .toBe(1);
  await tondo.close();
  const secondRun = path.join(workDir, "second");
  mkdirSync(secondRun);
  tondo = await launchWithPi({ workDir: secondRun, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await waitForPi(tondo.page);
  await expect(attachments(tondo.page).locator("img")).toHaveCount(1);
  await decoded(tondo.page);
  await expectDraft(tondo.page, "");
});
