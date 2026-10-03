import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
import { bringToFront, captureOpenExternal, type Tondo } from "./launch";
import { piGroup, piGroups } from "./processes";
import {
  addProject,
  bashCall,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
  waitForFileCommand,
} from "./pi";

let dir: string;
let project: string;
let remote: string;
let bin: string;
let env: Record<string, string>;
let tondo: Tondo | undefined;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-git-e2e-")));
  project = path.join(dir, "project");
  remote = path.join(dir, "remote.git");
  bin = path.join(dir, "commands");
  mkdirSync(project);
  mkdirSync(bin);
  env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GH_CONFIG_DIR: path.join(dir, "gh-config"),
  };
  git(project, "init", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.com");
  git(project, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, "README.md"), "Initial\n");
  writeFileSync(path.join(project, ".gitignore"), "ignored\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "initial");
  git(project, "init", "--bare", remote);
  git(project, "remote", "add", "origin", "git@github.example.com:team/repo.git");
  git(project, "config", `url.${remote}.insteadOf`, "git@github.example.com:team/repo.git");
  git(project, "push", "-u", "origin", "main");
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!${process.execPath}\nconst fs=require('fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(path.join(dir, "gh.jsonl"))},JSON.stringify({args:a,input:fs.readFileSync(0,'utf8')})+'\\n');if(fs.existsSync(${JSON.stringify(path.join(dir, "logged-out"))}))process.exit(1); if(a[0]==='pr'&&a[1]==='list')console.log(fs.existsSync(${JSON.stringify(path.join(dir, "created"))})?'[{"number":7,"title":"Test PR","state":"OPEN","url":"https://github.example.com/team/repo/pull/7"}]':'[]');if(a[1]==='create'){fs.writeFileSync(${JSON.stringify(path.join(dir, "created"))},'yes');console.log('https://github.example.com/team/repo/pull/7');}\n`,
  );
  chmodSync(gh, 0o755);
  // The test's login shell keeps its PATH, rather than loading the developer's dotfiles.
  const shell = path.join(dir, "shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n',
  );
  chmodSync(shell, 0o755);
  env.SHELL = shell;
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function start(responses = [bashCall("pwd | tee cwd-proof.txt"), reply("Path recorded.")]) {
  const profileDir = path.join(dir, "profile");
  mkdirSync(profileDir);
  tondo = await launchWithPi({ workDir: dir, profileDir, env, script: { responses } });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await expect(tondo.page.getByLabel("Git branch")).toHaveValue("main");
  return tondo;
}

async function submit(name: string) {
  const dialog = tondo!.page.getByRole("dialog");
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

function worktreePath(): string {
  const fields = git(project, "worktree", "list", "--porcelain", "-z").split("\0");
  const field = fields.find(
    (entry) => entry.startsWith("worktree ") && entry !== `worktree ${project}`,
  );
  if (!field) throw new Error("No linked worktree");
  return field.slice(9);
}

test("worktree tools, files, checkpoints, terminal and sessions use the checkout; commit, push and PR are explicit", async () => {
  test.setTimeout(90_000);
  const app = await start();
  let { page } = app;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await send(page, "Record local cwd");
  await expect(page.getByText("Path recorded.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await page.getByRole("button", { name: "New worktree", exact: true }).click();
  await page.getByLabel("Branch name", { exact: true }).fill("feature/worktree");
  await submit("Create worktree thread");
  await waitForPi(page);
  await expect(page.getByLabel("Git branch")).toHaveValue("feature/worktree");
  const checkout = worktreePath();
  expect(existsSync(path.join(checkout, "cwd-proof.txt"))).toBe(false);
  await send(page, "Record worktree cwd");
  await expect(page.getByText("Path recorded.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  expect(readFileSync(path.join(checkout, "cwd-proof.txt"), "utf8").trim()).toBe(checkout);
  expect(readFileSync(path.join(project, "cwd-proof.txt"), "utf8").trim()).toBe(project);
  writeFileSync(path.join(checkout, "worktree-only.txt"), "Only in the worktree");
  await composer(page).fill("Read @worktree");
  const files = page.getByRole("listbox", { name: "Files" });
  await expect(files.getByRole("option")).toHaveText(["worktree-only.txt"]);
  await files.getByRole("option").click();
  await expectDraft(page, "Read @worktree-only.txt ");
  await composer(page).press("ControlOrMeta+a");
  await composer(page).press("Backspace");
  await expectDraft(page, "");
  const sessionDir = path.join(
    app.profileDir,
    "pi-agent",
    "sessions",
    `--${checkout.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
  const sessionFile = path.join(
    sessionDir,
    readdirSync(sessionDir).find((file) => file.endsWith(".jsonl"))!,
  );
  expect(JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]!).cwd).toBe(checkout);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Turn changes" })).toContainText(
    "cwd-proof.txt",
  );
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const terminal = page.locator(".xterm-helper-textarea");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("$");
  await terminal.focus();
  await terminal.pressSequentially("pwd");
  await terminal.press("Enter");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText(checkout);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Refresh Git" }).click();
  await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await page.getByLabel("Commit message").fill("feat: record worktree cwd");
  await submit("Stage all and commit");
  expect(git(checkout, "log", "-1", "--format=%s")).toBe("feat: record worktree cwd");
  expect(git(project, "log", "-1", "--format=%s")).toBe("initial");
  expect(git(checkout, "ls-remote", "--heads", "origin", "feature/worktree")).toBe("");
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await submit("Push branch");
  expect(git(checkout, "ls-remote", "--heads", "origin", "feature/worktree")).toContain(
    git(checkout, "rev-parse", "HEAD"),
  );
  await page.getByRole("button", { name: "Create PR", exact: true }).click();
  await page.getByLabel("Pull request title").fill("Test PR");
  await page.getByLabel("Pull request description").fill("Test body");
  await submit("Create pull request");
  const link = page.getByRole("link", { name: "PR #7 · open", exact: true });
  await expect(link).toBeVisible();
  const opened = await captureOpenExternal(app.app);
  await link.click();
  expect(await opened()).toBe("https://github.example.com/team/repo/pull/7");
  const calls = readFileSync(path.join(dir, "gh.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls).toContainEqual({
    args: [
      "pr",
      "create",
      "--repo",
      "github.example.com/team/repo",
      "--head",
      "feature/worktree",
      "--base",
      "main",
      "--title",
      "Test PR",
      "--body-file",
      "-",
    ],
    input: "Test body",
  });
  await page.screenshot({ path: "test-results/git-worktree-pr.png" });
  await page.reload();
  await waitForPi(page);
  await expect(page.getByLabel("Git branch")).toHaveValue("feature/worktree");
  await expect(page.getByText("Path recorded.", { exact: true })).toBeVisible();
  await app.close();
  const restartDir = path.join(dir, "restart");
  mkdirSync(restartDir);
  tondo = await launchWithPi({
    workDir: restartDir,
    profileDir: app.profileDir,
    env,
    script: { responses: [reply("Resumed")] },
  });
  page = tondo.page;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await waitForPi(page);
  await expect(page.getByLabel("Git branch")).toHaveValue("feature/worktree");
  await expect(page.getByText("Path recorded.", { exact: true })).toBeVisible();
  const checkpoints = git(checkout, "for-each-ref", "--format=%(refname)", "refs/tondo");
  writeFileSync(path.join(checkout, "ignored"), "keep me");
  await page.getByRole("button", { name: "Remove worktree", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove worktree and forget thread", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("ignored files");
  expect(existsSync(path.join(checkout, "ignored"))).toBe(true);
  expect(git(checkout, "for-each-ref", "--format=%(refname)", "refs/tondo")).toBe(checkpoints);
  await page.screenshot({ path: "test-results/git-safe-removal.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(existsSync(checkout)).toBe(true);
  await page.getByRole("button", { name: "Remove worktree", exact: true }).click();
  await page.getByLabel("Permanently delete uncommitted and ignored files too").check();
  await submit("Remove worktree and forget thread");
  expect(existsSync(checkout)).toBe(false);
  expect(existsSync(sessionFile)).toBe(true);
  expect(git(project, "branch", "--list", "feature/worktree")).toContain("feature/worktree");
  await threadRows(page).filter({ hasText: "Record local cwd" }).click();
  await waitForPi(page);
  await expect(page.getByLabel("Git branch")).toHaveValue("main");
  expect(errors).toEqual([]);
});

test("branch changes are refused while a background local thread is mid-turn", async () => {
  const release = path.join(dir, "release");
  const { page } = await start([bashCall(waitForFileCommand(release)), reply("Released.")]);
  git(project, "branch", "other");
  await send(page, "Wait for release");
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();
  await page.getByRole("button", { name: "project", exact: true }).hover();
  await page.getByRole("button", { name: "New thread in project", exact: true }).click();
  await waitForPi(page);
  await expect(
    page.getByLabel("Git branch").locator("option", { hasText: "other" }),
  ).toBeAttached();
  await page.getByLabel("Git branch").selectOption("other");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch branch", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("pi is starting or working");
  expect(git(project, "branch", "--show-current")).toBe("main");
  writeFileSync(release, "go");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await threadRows(page).filter({ hasText: "Wait for release" }).click();
  await expect(page.getByText("Released.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await page.getByLabel("Git branch").selectOption("other");
  await submit("Switch branch");
  await expect(page.getByLabel("Git branch")).toHaveValue("other");
});

test("a terminal still protects its checkout after the pool stops its thread's pi", async () => {
  env.TONDO_POOL = JSON.stringify({ idleMs: 0 });
  const { page, app } = await start([reply("Ready.")]);
  await send(page, "Keep this shell");
  await expect(page.getByText("Ready.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  const first = await piGroup(app);
  git(project, "branch", "other");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("$");
  await page.getByRole("button", { name: "project", exact: true }).hover();
  await page.getByRole("button", { name: "New thread in project", exact: true }).click();
  await waitForPi(page);
  await expect.poll(() => piGroups(app)).not.toContain(first);
  await expect(
    page.getByLabel("Git branch").locator("option", { hasText: "other" }),
  ).toBeAttached();
  await page.getByLabel("Git branch").selectOption("other");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch branch", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Close terminals in this checkout");
  expect(git(project, "branch", "--show-current")).toBe("main");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await threadRows(page).filter({ hasText: "Keep this shell" }).click();
  await waitForPi(page);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "New branch", exact: true }).click();
  await page.getByLabel("Branch name", { exact: true }).fill("created-in-toolbar");
  await submit("Create branch");
  await expect(page.getByLabel("Git branch")).toHaveValue("created-in-toolbar");
});

test("gh login failures are shown and recover after explicit refresh", async () => {
  writeFileSync(path.join(dir, "logged-out"), "yes");
  const { page } = await start([reply("Hello")]);
  await expect(
    page.getByText("Sign in with gh auth login --hostname github.example.com, then refresh.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create PR", exact: true })).toBeDisabled();
  rmSync(path.join(dir, "logged-out"));
  await page.getByRole("button", { name: "Refresh Git" }).click();
  await expect(page.getByRole("button", { name: "Create PR", exact: true })).toBeEnabled();
});
