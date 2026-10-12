import { expect, test, type Locator, type Page } from "@playwright/test";
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
  threads,
  waitForIdle,
  waitForPi,
  waitForFileCommand,
} from "./pi";
import { pickOption } from "./ui";

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
  await expectBranch(tondo.page, "main");
  return tondo;
}

/** Expects the header's breadcrumb to name `name` as the checked-out branch. */
async function expectBranch(page: Page, name: string): Promise<void> {
  await expect(page.locator("header").getByText(`Branch ${name}`, { exact: true })).toBeVisible();
}

/** The status row's Git pill. */
function gitPill(page: Page): Locator {
  return page.getByLabel("Git status", { exact: true });
}

/** Opens the Git menu behind the header's Commit & push chevron. */
async function gitMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Git actions", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Closes the open Git menu without choosing. */
async function closeGitMenu(page: Page, menu: Locator): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

/** Chooses the Git action named `name` in the header's Git menu. */
async function gitAction(page: Page, name: string): Promise<void> {
  const menu = await gitMenu(page);
  await menu.getByRole("menuitem", { name, exact: true }).click();
  await expect(menu).toBeHidden();
}

/** Expects the Git menu's `name` item to be enabled or not, then closes the menu. */
async function expectGitAction(page: Page, name: string, enabled: boolean): Promise<void> {
  const menu = await gitMenu(page);
  const item = menu.getByRole("menuitem", { name, exact: true });
  if (enabled) await expect(item).toBeEnabled();
  else await expect(item).toBeDisabled();
  await closeGitMenu(page, menu);
}

/** Opens Switch branch and picks `name`, leaving its confirmation open. */
async function pickBranch(page: Page, name: string): Promise<Locator> {
  await gitAction(page, "Switch branch");
  const dialog = page.getByRole("alertdialog");
  await pickOption(dialog, "Git branch", name);
  return dialog;
}

async function submit(name: string) {
  const { page } = tondo!;
  // Switching branches and removing a worktree ask in an alert dialog.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
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
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("feature/worktree");
  await submit("Create worktree thread");
  await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
  await waitForPi(page);
  await expectBranch(page, "feature/worktree");
  await expect(gitPill(page)).toContainText("Worktree");
  await expect(threadRows(page)).toHaveCount(1);
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
  await gitAction(page, "Refresh");
  await expect(gitPill(page)).toContainText("2 changes");
  await expectGitAction(page, "Commit", true);
  await gitAction(page, "Commit");
  await page.getByLabel("Commit message").fill("feat: record worktree cwd");
  await submit("Stage all and commit");
  expect(git(checkout, "log", "-1", "--format=%s")).toBe("feat: record worktree cwd");
  expect(git(project, "log", "-1", "--format=%s")).toBe("initial");
  expect(git(checkout, "ls-remote", "--heads", "origin", "feature/worktree")).toBe("");
  await gitAction(page, "Push");
  await submit("Push branch");
  expect(git(checkout, "ls-remote", "--heads", "origin", "feature/worktree")).toContain(
    git(checkout, "rev-parse", "HEAD"),
  );
  await expect(gitPill(page)).toContainText("Up to date with origin/feature/worktree");
  await gitAction(page, "Create PR");
  await page.getByLabel("Pull request title").fill("Test PR");
  await page.getByLabel("Pull request description").fill("Test body");
  await submit("Create pull request");
  const menu = await gitMenu(page);
  const link = menu.getByRole("menuitem", { name: "PR #7 · open", exact: true });
  await expect(link).toHaveAttribute("href", "https://github.example.com/team/repo/pull/7");
  await expect(menu.getByRole("menuitem", { name: "Create PR", exact: true })).toHaveCount(0);
  const opened = await captureOpenExternal(app.app);
  await link.click();
  expect(await opened()).toBe("https://github.example.com/team/repo/pull/7");
  await expect(menu).toBeHidden();
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
  await expectBranch(page, "feature/worktree");
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
  await expectBranch(page, "feature/worktree");
  await expect(page.getByText("Path recorded.", { exact: true })).toBeVisible();
  const checkpoints = git(checkout, "for-each-ref", "--format=%(refname)", "refs/tondo");
  writeFileSync(path.join(checkout, "ignored"), "keep me");
  await gitAction(page, "Remove worktree");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove worktree", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("ignored files");
  expect(existsSync(path.join(checkout, "ignored"))).toBe(true);
  expect(git(checkout, "for-each-ref", "--format=%(refname)", "refs/tondo")).toBe(checkpoints);
  await page.screenshot({ path: "test-results/git-safe-removal.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  expect(existsSync(checkout)).toBe(true);
  await gitAction(page, "Remove worktree");
  await page
    .getByRole("checkbox", { name: "Permanently delete uncommitted and ignored files too" })
    .check();
  await submit("Remove worktree");
  expect(existsSync(checkout)).toBe(false);
  expect(existsSync(sessionFile)).toBe(true);
  await expect(threadRows(page).filter({ hasText: "Record worktree cwd" })).toBeVisible();
  expect(git(project, "branch", "--list", "feature/worktree")).toContain("feature/worktree");
  await threadRows(page).filter({ hasText: "Record local cwd" }).click();
  await waitForPi(page);
  await expectBranch(page, "main");
  await expect(gitPill(page)).toContainText("Local");
  expect(errors).toEqual([]);
});

test("Commit & push commits, then pushes to the remote, and is disabled with a clean tree", async () => {
  const { page } = await start([reply("Hello")]);
  const commitAndPush = page.getByRole("button", { name: "Commit & push", exact: true });
  await expect(commitAndPush).toBeDisabled();
  const menu = await gitMenu(page);
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Commit",
    "Push",
    "Create PR",
    "Switch branch",
    "New branch",
    "New worktree",
    "Refresh",
  ]);
  await closeGitMenu(page, menu);
  writeFileSync(path.join(project, "feature.txt"), "feature\n");
  await gitAction(page, "Refresh");
  await expect(gitPill(page)).toContainText("1 change");
  await expect(commitAndPush).toBeEnabled();
  await commitAndPush.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Commit message").fill("feat: add feature");
  await dialog.getByRole("button", { name: "Stage all and commit", exact: true }).click();
  // The push asks next, once the commit's dialog has gone.
  await expect(dialog.getByRole("heading", { name: "Push branch", exact: true })).toBeVisible();
  await submit("Push branch");
  expect(git(project, "log", "-1", "--format=%s")).toBe("feat: add feature");
  expect(git(remote, "rev-parse", "refs/heads/main")).toBe(git(project, "rev-parse", "HEAD"));
  await expect(gitPill(page)).toContainText("No changes");
  await expect(gitPill(page)).toContainText("Up to date with origin/main");
  // The clean tree disables Commit & push, so focus lands on the split button's chevron.
  await expect(commitAndPush).toBeDisabled();
  await expect(page.getByRole("button", { name: "Git actions", exact: true })).toBeFocused();
});

test("branch changes are refused while a background local thread is mid-turn", async () => {
  const release = path.join(dir, "release");
  const { page } = await start([bashCall(waitForFileCommand(release)), reply("Released.")]);
  git(project, "branch", "other");
  await send(page, "Wait for release");
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();
  await page.getByRole("button", { name: "project", exact: true }).hover();
  await page.getByRole("button", { name: "New thread in project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
  await waitForPi(page);
  const dialog = await pickBranch(page, "other");
  await dialog.getByRole("button", { name: "Switch branch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("pi is starting or working");
  expect(git(project, "branch", "--show-current")).toBe("main");
  writeFileSync(release, "go");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectBranch(page, "main");
  await threadRows(page).filter({ hasText: "Wait for release" }).click();
  await expect(page.getByText("Released.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await pickBranch(page, "other");
  await submit("Switch branch");
  await expectBranch(page, "other");
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
  // Do not mistake the previous thread's still-visible model picker for the new pi.
  await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
  await waitForPi(page);
  await expect.poll(() => piGroups(app)).not.toContain(first);
  const dialog = await pickBranch(page, "other");
  await dialog.getByRole("button", { name: "Switch branch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Close terminals in this checkout");
  expect(git(project, "branch", "--show-current")).toBe("main");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await threadRows(page).filter({ hasText: "Keep this shell" }).click();
  await expect(page.getByRole("heading", { name: "Keep this shell", exact: true })).toBeVisible();
  await waitForPi(page);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await gitAction(page, "New branch");
  await page.getByLabel("Branch name", { exact: true }).fill("created-in-menu");
  await submit("Create branch");
  await expectBranch(page, "created-in-menu");
});

test("gh login failures are shown and recover after explicit refresh", async () => {
  writeFileSync(path.join(dir, "logged-out"), "yes");
  const { page } = await start([reply("Hello")]);
  const menu = await gitMenu(page);
  await expect(
    menu.getByText("Sign in with gh auth login --hostname github.example.com, then refresh.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Create PR", exact: true })).toBeDisabled();
  await closeGitMenu(page, menu);
  rmSync(path.join(dir, "logged-out"));
  await gitAction(page, "Refresh");
  await expectGitAction(page, "Create PR", true);
});

test("an unresolved merge is shown and Commit waits until its conflicts are resolved", async () => {
  git(project, "switch", "-c", "topic");
  writeFileSync(path.join(project, "README.md"), "topic side\n");
  git(project, "commit", "-am", "topic");
  git(project, "switch", "main");
  writeFileSync(path.join(project, "README.md"), "main side\n");
  git(project, "commit", "-am", "main");
  expect(() => git(project, "merge", "topic")).toThrow();
  const { page } = await start([reply("Hello")]);
  await expect(
    gitPill(page).getByText("Merge in progress, 1 conflict", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit & push", exact: true })).toBeDisabled();
  await expectGitAction(page, "Commit", false);
  writeFileSync(path.join(project, "README.md"), "resolved\n");
  git(project, "add", "README.md");
  await gitAction(page, "Refresh");
  await expect(gitPill(page).getByText("Merge in progress", { exact: true })).toBeVisible();
  await gitAction(page, "Commit");
  await page.getByLabel("Commit message").fill("merge topic");
  await submit("Stage all and commit");
  await expect(gitPill(page).getByText("Merge in progress", { exact: true })).toBeHidden();
  expect(git(project, "show", "HEAD:README.md")).toBe("resolved");
  expect(git(project, "rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);
});

test("a blank commit message or branch name is refused in the dialog instead of hanging", async () => {
  writeFileSync(path.join(project, "new.txt"), "new\n");
  const { page } = await start([reply("Hello")]);
  const dialog = page.getByRole("dialog");
  await gitAction(page, "Commit");
  await dialog.getByLabel("Commit message").fill("   \n  ");
  await dialog.getByRole("button", { name: "Stage all and commit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a commit message.");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(git(project, "log", "-1", "--format=%s")).toBe("initial");
  await gitAction(page, "New branch");
  await dialog.getByLabel("Branch name", { exact: true }).fill("   ");
  await dialog.getByRole("button", { name: "Create branch", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a branch name.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectGitAction(page, "Commit", true);
  expect(git(project, "branch", "--show-current")).toBe("main");
});

test("a worktree whose folder was deleted outside Tondo can be removed, and then its project", async () => {
  const { page } = await start();
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("feature/gone");
  await submit("Create worktree thread");
  await waitForPi(page);
  await expectBranch(page, "feature/gone");
  await expect(threadRows(page)).toHaveCount(0);
  await composer(page).fill("Keep this worktree draft");
  await expect(threadRows(page)).toHaveCount(1);
  const checkout = worktreePath();
  rmSync(checkout, { recursive: true, force: true });

  await gitAction(page, "Refresh");
  await expect(gitPill(page)).toContainText("Git unavailable");
  const menu = await gitMenu(page);
  await expect(menu).toContainText("This worktree's folder was deleted outside Tondo");
  await menu.getByRole("menuitem", { name: "Remove worktree", exact: true }).click();
  await expect(menu).toBeHidden();
  await submit("Remove worktree");
  await expect(threadRows(page)).toHaveCount(1);
  expect(git(project, "worktree", "list", "--porcelain")).not.toContain(checkout);
  expect(git(project, "branch", "--list", "feature/gone")).toContain("feature/gone");

  await threads(page).getByRole("button", { name: "project", exact: true }).click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  await expect(threads(page).getByRole("button", { name: "project", exact: true })).toHaveCount(0);
  await expect(threadRows(page)).toHaveCount(0);
});
