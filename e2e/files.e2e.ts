import type { UserMessage } from "@earendil-works/pi-ai";
import { expect, test, type Page } from "@playwright/test";
import type { OpenDialogOptions } from "electron";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendFilePaths } from "../src/renderer/composer/filePaths";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  threadRows,
  toolCalls,
  waitForIdle,
  waitForPi,
} from "./pi";
import { sessionFolder } from "./sessions";

let dir: string;
let project: string;
let profileDir: string;
let tondo: Tondo | undefined;
let errors: string[];

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-files-e2e-")));
  project = path.join(dir, "project");
  profileDir = path.join(dir, "profile");
  mkdirSync(project);
  mkdirSync(profileDir);
  errors = [];
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

function recordErrors(page: Page): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

async function start(): Promise<Page> {
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    script: { responses: [reply("Files received.")] },
  });
  recordErrors(tondo.page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  return tondo.page;
}

async function pick(paths: string[]): Promise<void> {
  await tondo!.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as OpenDialogOptions;
      if (
        options.filters ||
        !options.properties?.includes("multiSelections") ||
        !options.properties.includes("openFile")
      )
        throw new Error("Expected an unfiltered multi-file picker");
      return { canceled: chosen.length === 0, filePaths: chosen };
    };
  }, paths);
  await tondo!.page.getByRole("button", { name: "Attach files", exact: true }).click();
}

test("the unfiltered picker sends original paths and real pi reads a file outside the project", async () => {
  const csv = path.join(dir, 'data with "quotes".csv');
  const source = "name,total\ncanary,4217\n";
  writeFileSync(csv, source);
  const unknown = path.join(dir, "archive.custom-extension");
  writeFileSync(unknown, Buffer.from([0, 1, 255]));
  const inputs = path.join(dir, "inputs.json");
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    script: {
      recordInputs: inputs,
      responses: [
        toolCalls({ name: "read", arguments: { path: csv } }),
        reply("Finished reading the selected file."),
      ],
    },
  });
  const { page } = tondo;
  recordErrors(page);
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await composer(page).fill("Inspect the CSV; identify the other file type.");
  await pick([csv, unknown]);
  const draft = appendFilePaths("Inspect the CSV; identify the other file type.", [csv, unknown]);
  await expectDraft(page, draft);
  await page.screenshot({
    path: test.info().outputPath("local-paths.png"),
    animations: "disabled",
  });
  await composer(page).press("Enter");
  await expect(
    page.getByText("Finished reading the selected file.", { exact: true }),
  ).toBeVisible();
  await waitForIdle(page);
  await expectDraft(page, "");
  const received = JSON.parse(readFileSync(inputs, "utf8")) as UserMessage[];
  const content = received[0]!.content;
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  expect(text).toBe(draft);
  const sessions = sessionFolder(profileDir, project);
  const file = readdirSync(sessions).find((name) => name.endsWith(".jsonl"))!;
  const records = readFileSync(path.join(sessions, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records).toContainEqual(
    expect.objectContaining({
      type: "message",
      message: expect.objectContaining({
        role: "toolResult",
        toolName: "read",
        isError: false,
        content: expect.arrayContaining([expect.objectContaining({ type: "text", text: source })]),
      }),
    }),
  );
  expect(readFileSync(csv, "utf8")).toBe(source);
  expect(readFileSync(unknown)).toEqual(Buffer.from([0, 1, 255]));
});

test("file paths survive thread switches and a cold restart, and remain editable", async () => {
  const page = await start();
  const file = path.join(dir, "notes.txt");
  writeFileSync(file, "notes");
  await pick([file]);
  const draft = appendFilePaths("", [file]);
  await expectDraft(page, draft);
  await page.keyboard.press("ControlOrMeta+n");
  await expectDraft(page, "");
  await expect(threadRows(page)).toHaveCount(1);
  await page.getByRole("img", { name: "Unsent draft" }).click();
  await expectDraft(page, draft);
  await tondo!.close();
  const second = path.join(dir, "second");
  mkdirSync(second);
  tondo = await launchWithPi({ workDir: second, profileDir, script: { responses: [] } });
  recordErrors(tondo.page);
  await waitForPi(tondo.page);
  await expectDraft(tondo.page, draft);
  await composer(tondo.page).fill("Replaced the file references.");
  await expectDraft(tondo.page, "Replaced the file references.");
});

test("a selection returned after a thread switch never changes the new thread's draft", async () => {
  const page = await start();
  await composer(page).fill("Original thread");
  const originalFile = path.join(dir, "original-thread-only.txt");
  writeFileSync(originalFile, "Original thread only");
  await tondo!.app.evaluate(({ dialog }) => {
    const pending = {
      resolve: undefined as
        | ((result: { canceled: boolean; filePaths: string[] }) => void)
        | undefined,
    };
    Object.assign(globalThis, { tondoFilesPicker: pending });
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        pending.resolve = resolve;
      });
  });
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await expect
    .poll(() =>
      tondo!.app.evaluate(() =>
        Boolean(
          (globalThis as typeof globalThis & { tondoFilesPicker: { resolve?: unknown } })
            .tondoFilesPicker.resolve,
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+n");
  await expectDraft(page, "");
  await composer(page).fill("New thread");
  await tondo!.app.evaluate((_electron, file) => {
    const pending = (
      globalThis as typeof globalThis & {
        tondoFilesPicker: { resolve: (result: { canceled: boolean; filePaths: string[] }) => void };
      }
    ).tondoFilesPicker;
    pending.resolve({ canceled: false, filePaths: [file] });
  }, originalFile);
  await expect(
    page.getByText("Files weren't attached because you switched threads. Choose them again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expectDraft(page, "New thread");
});

test("cancellation and picker errors preserve the current draft", async () => {
  const page = await start();
  await composer(page).fill("Keep this thought");
  await pick([]);
  await expectDraft(page, "Keep this thought");
  await tondo!.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw new Error("Picker unavailable");
    };
  });
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await expect(
    page.getByText("Couldn't choose files: Picker unavailable", { exact: true }),
  ).toBeVisible();
  await expectDraft(page, "Keep this thought");
});
