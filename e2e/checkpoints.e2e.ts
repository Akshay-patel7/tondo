import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMAGE_FIXTURE } from "../src/shared/imageFixture";
import { bringToFront, hostPid, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  toolCalls,
  waitForFileCommand,
  waitForIdle,
  waitForPi,
} from "./pi";
import { piGroups, processesIn } from "./processes";

test.describe.configure({ timeout: 60_000 });
let workDir: string;
let project: string;
let tondo: Tondo | undefined;
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: project, encoding: "utf8", stdio: "pipe" });
}
test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-checkpoints-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

test("faux pi edits files, the panel switches files and turns, and checkpoints survive a host restart and page reload", async () => {
  git("init", "-q");
  mkdirSync(path.join(project, "src"));
  writeFileSync(path.join(project, "src/answer.ts"), "export const answer = 41;\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", "fixture");
  const index = readFileSync(path.join(project, ".git/index"));
  tondo = await launchWithPi({
    workDir,
    script: {
      responses: [
        toolCalls(
          {
            id: "edit_answer",
            name: "edit",
            arguments: { path: "src/answer.ts", edits: [{ oldText: "41", newText: "42" }] },
          },
          {
            id: "write_notes",
            name: "write",
            arguments: { path: "notes.md", content: "# Notes\n\nCorrected the answer.\n" },
          },
        ),
        reply("First turn finished."),
        toolCalls({
          id: "edit_again",
          name: "edit",
          arguments: { path: "src/answer.ts", edits: [{ oldText: "42", newText: "43" }] },
        }),
        reply("Second turn finished."),
      ],
    },
  });
  const { page } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Turn changes" });
  await expect(panel).toContainText("No turn checkpoints yet");
  await send(page, "Correct the answer and add notes.");
  await expect(panel.getByRole("button", { name: "Show diff for src/answer.ts" })).toBeVisible();
  await panel.getByRole("button", { name: "Show diff for src/answer.ts" }).click();
  const code = panel.locator("diffs-container");
  await expect(code).toContainText("export const answer = 41;");
  await expect(code).toContainText("export const answer = 42;");
  await expect
    .poll(() =>
      code.evaluate((host) =>
        Boolean(host.shadowRoot?.querySelector('span[style*="--diffs-token"]')),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("turn-diff.png"), animations: "disabled" });
  await panel.getByRole("button", { name: "Show diff for notes.md" }).click();
  await expect(code).toContainText("Corrected the answer.");
  await panel.getByRole("textbox", { name: "Filter changed files" }).fill("answer");
  await expect(panel.getByRole("button", { name: "Show diff for notes.md" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: "Filter changed files" }).fill("");
  await panel.locator("summary").filter({ hasText: "src/" }).click();
  await expect(panel.getByRole("button", { name: "Show diff for src/answer.ts" })).toBeHidden();
  await panel.locator("summary").filter({ hasText: "src/" }).press("Enter");
  await expect(panel.getByRole("button", { name: "Show diff for src/answer.ts" })).toBeVisible();

  await send(page, "Change it once more.");
  await expect(page.getByText("Second turn finished.")).toBeVisible();
  await expect(code).toContainText("export const answer = 43;");
  await panel.getByLabel("Checkpoint turn").selectOption("1");
  await panel.getByRole("button", { name: "Show diff for src/answer.ts" }).click();
  await expect(code).toContainText("export const answer = 41;");
  await expect(code).not.toContainText("export const answer = 43;");
  expect(readFileSync(path.join(project, ".git/index"))).toEqual(index);

  const previousHost = await hostPid(tondo.app);
  process.kill(previousHost, "SIGKILL");
  await expect.poll(() => hostPid(tondo!.app).catch(() => previousHost)).not.toBe(previousHost);
  await expect(panel.getByLabel("Checkpoint turn").locator("option")).toHaveCount(3);
  await panel.getByLabel("Checkpoint turn").selectOption("2");
  await expect(code).toContainText("export const answer = 43;");
  await page.reload();
  await waitForPi(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(panel.getByLabel("Checkpoint turn").locator("option")).toHaveCount(3);
  await expect(code).toContainText("export const answer = 43;");
  await panel.getByRole("button", { name: "Close changes" }).click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);

  // Forgetting the project removes its checkpoint refs, not the worktree or HEAD.
  const head = git("rev-parse", "HEAD");
  expect(git("for-each-ref", "--format=%(refname)", "refs/tondo").trim().split("\n")).toHaveLength(
    3,
  );
  await page.getByRole("button", { name: "project", exact: true }).hover();
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  await page.getByRole("menuitem", { name: "Remove project", exact: true }).click();
  await expect.poll(() => git("for-each-ref", "--format=%(refname)", "refs/tondo")).toBe("");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(path.join(project, "src/answer.ts"), "utf8")).toContain("43");
  expect(errors).toEqual([]);
});

test("queued work shares one checkpoint turn and an aborted turn keeps its edits", async () => {
  git("init", "-q");
  writeFileSync(path.join(project, "file.txt"), "before\n");
  const release = path.join(workDir, "release");
  tondo = await launchWithPi({
    workDir,
    script: {
      responses: [
        bashCall(`printf 'after\\n' > file.txt; ${waitForFileCommand(release)}`),
        reply("Steered."),
        reply("Followed up."),
        bashCall(
          `printf 'kept\\n' > aborted.txt; ${waitForFileCommand(path.join(workDir, "never"))}`,
        ),
      ],
    },
  });
  const { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Turn changes" });
  await send(page, "Start.");
  await expect.poll(() => readFileSync(path.join(project, "file.txt"), "utf8")).toBe("after\n");
  await send(page, "Steer this.");
  await send(page, "Then this.", "Alt+Enter");
  await expect(page.getByRole("region", { name: "Queued messages" })).toContainText(
    "Follow-up: Then this.",
  );
  writeFileSync(release, "");
  await waitForIdle(page);
  await expect(page.getByText("Followed up.", { exact: true })).toBeVisible();
  await expect(panel.locator("diffs-container")).toContainText("after");
  await expect(panel.getByLabel("Checkpoint turn").locator("option")).toHaveCount(2);
  await send(page, "Make a change, then stop.");
  await expect.poll(() => existsSync(path.join(project, "aborted.txt"))).toBe(true);
  await composer(page).press("Escape");
  await waitForIdle(page);
  await expect(panel.getByRole("button", { name: "Show diff for aborted.txt" })).toBeVisible();
  await expect(panel.locator("diffs-container")).toContainText("kept");
  await expect(panel.getByLabel("Checkpoint turn").locator("option")).toHaveCount(3);
});

/** A real clean filter, held by a file-system event rather than a sleep. */
function pauseCapture(): { marker: string; release: string; arm: string } {
  git("init", "-q");
  const arm = path.join(workDir, "pause-filter");
  writeFileSync(arm, "");
  const marker = path.join(workDir, "filter-started.json");
  const release = path.join(workDir, "release");
  const script = path.join(workDir, "filter.cjs");
  writeFileSync(
    script,
    `const fs = require('node:fs');
const release = ${JSON.stringify(release)};
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (!fs.existsSync(${JSON.stringify(arm)}) || fs.existsSync(release)) { process.stdout.write(input); return; }
  const watcher = fs.watch(${JSON.stringify(workDir)}, () => { if (fs.existsSync(release)) { watcher.close(); process.stdout.write(input); } });
  fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ git: process.ppid, filter: process.pid, index: process.env.GIT_INDEX_FILE }));
});\n`,
  );
  git("config", "filter.pause.clean", `exec '${process.execPath}' '${script}'`);
  git("config", "filter.pause.required", "true");
  writeFileSync(path.join(project, ".gitattributes"), "file.txt filter=pause\n");
  writeFileSync(path.join(project, "file.txt"), "before\n");
  return { marker, release, arm };
}

test("an image prompt waits for a stopped turn's completion checkpoint", async () => {
  const { marker, release, arm } = pauseCapture();
  rmSync(arm);
  tondo = await launchWithPi({
    workDir,
    script: {
      tokensPerSecond: 200,
      responses: [reply("word ".repeat(20_000)), reply("Saw the image after the checkpoint.")],
    },
  });
  const { page } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Start a turn.");
  await expect(page.locator("[data-streaming]")).toContainText("word");
  // The baseline passed. Hold only the completion capture, after Stop.
  writeFileSync(path.join(project, "file.txt"), "after\n");
  writeFileSync(arm, "");
  await composer(page).press("Escape");
  try {
    await expect.poll(() => existsSync(marker)).toBe(true);
    await waitForIdle(page);
    await page.getByLabel("Choose images").setInputFiles({
      name: IMAGE_FIXTURE.name,
      mimeType: IMAGE_FIXTURE.mimeType,
      buffer: Buffer.from(IMAGE_FIXTURE.data, "base64"),
    });
    await expect(page.getByLabel("Attached images", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // Host-side prompt preparation holds the image until the old capture ends.
    await expect(page.getByRole("button", { name: "Stop pi", exact: true })).toBeVisible();
    await expect(
      page.getByText("Saw the image after the checkpoint.", { exact: true }),
    ).toHaveCount(0);
  } finally {
    writeFileSync(release, "");
  }
  await expect(
    page.getByText("Saw the image after the checkpoint.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Attached images", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Preview Image 1", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Escape during baseline capture cancels the pending prompt before it reaches pi", async () => {
  const { marker, release } = pauseCapture();
  tondo = await launchWithPi({ workDir, script: { responses: [reply("This must not run.")] } });
  const { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Cancel before pi starts.");
  await expect.poll(() => existsSync(marker)).toBe(true);
  await expect(page.getByRole("button", { name: "Stop pi", exact: true })).toBeVisible();
  await composer(page).press("Escape");
  writeFileSync(release, "");
  await expectDraft(page, "Cancel before pi starts.");
  await expect(page.getByText("This must not run.", { exact: true })).toHaveCount(0);
  expect(git("for-each-ref", "--format=%(refname)", "refs/tondo").trim()).toMatch(/\/turn\/0$/);
});

test("killing the host during capture reaps Git and its filter and leaves a valid repository", async () => {
  const { marker } = pauseCapture();
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  const { page, app } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Start a checkpoint.");
  await expect.poll(() => existsSync(marker)).toBe(true);
  const capture = JSON.parse(readFileSync(marker, "utf8")) as {
    git: number;
    filter: number;
    index: string;
  };
  expect(capture.index).toContain("tondo-checkpoint-");
  await expect.poll(() => piGroups(app)).toContain(capture.git);
  const oldHost = await hostPid(app);
  process.kill(oldHost, "SIGKILL");
  await expect.poll(() => processesIn([capture.git])).toEqual([]);
  await expect.poll(() => hostPid(app).catch(() => oldHost)).not.toBe(oldHost);
  expect(git("for-each-ref", "--format=%(refname)", "refs/tondo")).toBe("");
  git("fsck", "--full");
  expect(existsSync(path.join(project, ".git/index.lock"))).toBe(false);
});

test("a non-Git folder explains why the panel has no diffs", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [reply("No file changes.")] } });
  const { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Turn changes" });
  await expect(panel).toContainText("not a Git checkout");
  await send(page, "Hello.");
  await expect(page.getByText("No file changes.")).toBeVisible();
  await expect(panel).toContainText("not a Git checkout");
  await page.screenshot({ path: test.info().outputPath("non-git.png"), animations: "disabled" });
});
