import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Tondo } from "./launch";
import { IMAGE_FIXTURE } from "../src/shared/imageFixture";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  pickFiles,
  PI_START_TIMEOUT_MS,
  reply,
  THREAD_ROW,
  threads,
} from "./pi";
import { pickOption } from "./ui";

let dir: string;
let tondo: Tondo | undefined;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-home-e2e-")));
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function folder(name: string): string {
  const created = path.join(dir, name);
  mkdirSync(created);
  return created;
}

function projectSection(page: Page, name: string) {
  return threads(page).getByRole("region", { name, exact: true });
}

/**
 * Adds `folders` and leaves no thread open: adding a project opens a thread in
 * it, so the last one added is a scratch project that is then removed.
 */
async function openHome(folders: readonly string[]): Promise<Page> {
  tondo = await launchWithPi({
    workDir: dir,
    script: { responses: [reply("Home reply from pi.")] },
  });
  const { page } = tondo;
  const started = tondo;
  // One at a time: each waits for the folder dialog the previous one answered.
  await [...folders, folder("scratch")].reduce(async (previous, added) => {
    await previous;
    await addProject(started, added);
    await expect(projectSection(page, path.basename(added))).toBeVisible();
  }, Promise.resolve());
  await threads(page).getByRole("button", { name: "scratch", exact: true }).click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove scratch", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "What should pi work on?" })).toBeVisible();
  return page;
}

async function sendFromHome(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("the first send from home starts a thread in the project you pick, and pi answers it", async () => {
  const page = await openHome([folder("alpha"), folder("beta")]);
  await pickOption(page, "Project", "beta");
  await expect(page.getByRole("combobox", { name: "Project" })).toContainText("beta");

  await sendFromHome(page, "Summarize this project");

  await expect(page.getByText("Home reply from pi.")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await expect(projectSection(page, "beta").locator(THREAD_ROW)).toHaveCount(1);
  await expect(projectSection(page, "alpha").locator(THREAD_ROW)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should pi work on?" })).toBeHidden();
});

test("home sends images and original file paths from one picker in its first prompt", async () => {
  const page = await openHome([folder("alpha")]);
  const file = path.join(dir, "outside-project.csv");
  writeFileSync(file, "name,value\ncanary,42\n");
  await composer(page).fill("Review this file");
  const image = path.join(dir, IMAGE_FIXTURE.name);
  writeFileSync(image, Buffer.from(IMAGE_FIXTURE.data, "base64"));
  await pickFiles(tondo!, [image, file]);
  await expect(page.getByLabel("Attached images", { exact: true }).locator("img")).toHaveCount(1);
  await expectDraft(page, `Review this file\n\nRead these local files:\n- ${JSON.stringify(file)}`);
  await page.screenshot({
    path: test.info().outputPath("home-file-path.png"),
    animations: "disabled",
  });
  await composer(page).press("Enter");
  await expect(page.getByText("Home reply from pi.", { exact: true })).toBeVisible({
    timeout: PI_START_TIMEOUT_MS,
  });
  await expect(page.locator('[data-index="0"]')).toContainText(file);
  await expect(
    page.locator('[data-index="0"]').getByRole("button", { name: "Preview Image 1", exact: true }),
  ).toBeVisible();
});

test("New worktree on a Git project starts the thread in a managed worktree", async () => {
  const repo = folder("repo");
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "README.md"), "Home\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  const page = await openHome([folder("plain"), repo]);
  await pickOption(page, "Project", "repo");
  await expect(page.getByLabel("Branch main")).toBeVisible();
  await page.getByRole("button", { name: "New worktree", exact: true }).click();
  await expect(page.getByRole("button", { name: "New worktree", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await sendFromHome(page, "Try the parser fix");

  await expect(page.getByText("Home reply from pi.")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  const rows = projectSection(page, "repo").locator(THREAD_ROW);
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole("img", { name: "Worktree" })).toBeVisible();
  const worktrees = path.join(realpathSync(tondo!.profileDir), "worktrees");
  const listed = git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  expect(listed.filter((checkout) => checkout.startsWith(worktrees + path.sep))).toHaveLength(1);
  expect(git(repo, "branch", "--list", "tondo/*")).toContain("tondo/try-the-parser-fix-");
});

test("a project that isn't a Git checkout offers only its local folder", async () => {
  const page = await openHome([folder("notes")]);
  await expect(page.getByRole("combobox", { name: "Project" })).toContainText("notes");
  await expect(page.getByRole("group", { name: "Checkout" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
});

test("a failed worktree creation keeps the prompt as a draft without running it locally", async () => {
  const repo = folder("repo");
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "README.md"), "Home\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  // A real branch named tondo prevents creating a nested tondo/<prompt> ref.
  git(repo, "branch", "tondo");
  const page = await openHome([repo]);
  await expect(page.getByLabel("Branch main")).toBeVisible();
  await page.getByRole("button", { name: "New worktree", exact: true }).click();

  const prompt = "Change files only in the new worktree";
  await sendFromHome(page, prompt);

  await expect(page.getByText(/Couldn't create the worktree:/)).toBeVisible({
    timeout: PI_START_TIMEOUT_MS,
  });
  await expect(composer(page)).toHaveText(prompt);
  await expect(page.getByText("Home reply from pi.")).toHaveCount(0);
  expect(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
});
