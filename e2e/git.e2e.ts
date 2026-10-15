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
import { bringToFront, captureOpenExternal, launchTondo, type Tondo } from "./launch";
import { piGroup, piGroups } from "./processes";
import {
  addProject,
  answerFolderDialog,
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
    `#!${process.execPath}\nconst fs=require('fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(path.join(dir, "gh.jsonl"))},JSON.stringify({args:a,input:fs.readFileSync(0,'utf8')})+'\\n');if(fs.existsSync(${JSON.stringify(path.join(dir, "logged-out"))}))process.exit(1); if(a[0]==='pr'&&a[1]==='list'){const f=${JSON.stringify(path.join(dir, "pr-branch"))};const branch=a[a.indexOf('--head')+1];console.log(fs.existsSync(${JSON.stringify(path.join(dir, "created"))})&&(!fs.existsSync(f)||fs.readFileSync(f,'utf8')===branch)?'[{"number":7,"title":"Test PR","state":"OPEN","url":"https://github.example.com/team/repo/pull/7"}]':'[]');}if(a[1]==='create'){fs.writeFileSync(${JSON.stringify(path.join(dir, "created"))},'yes');console.log('https://github.example.com/team/repo/pull/7');}\n`,
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
  await chooseBranch(dialog, "Git branch", name);
  return dialog;
}

async function chooseBranch(dialog: Locator, label: string, name: string): Promise<void> {
  await dialog.getByLabel(label, { exact: true }).click();
  const page = dialog.page();
  await page.getByRole("combobox", { name: "Search branches", exact: true }).fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

async function captureThemes(page: Page, name: string): Promise<void> {
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: test.info().outputPath(`${name}-light.png`),
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: test.info().outputPath(`${name}-dark.png`),
    animations: "disabled",
  });
}

async function submit(name: string) {
  const { page } = tondo!;
  // Switching branches and removing a worktree ask in an alert dialog.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Commits `file` in a second checkout of the remote and pushes it to main, as a teammate would. Returns the pushed commit. */
function pushFromElsewhere(file: string, text: string): string {
  const other = path.join(dir, "other");
  if (!existsSync(other)) {
    git(dir, "clone", "-b", "main", remote, other);
    git(other, "config", "user.name", "Other");
    git(other, "config", "user.email", "other@example.com");
    git(other, "config", "commit.gpgsign", "false");
  }
  writeFileSync(path.join(other, file), text);
  git(other, "add", file);
  git(other, "commit", "-m", `add ${file}`);
  git(other, "push", "origin", "main");
  return git(other, "rev-parse", "HEAD");
}

function worktreePath(): string {
  const fields = git(project, "worktree", "list", "--porcelain", "-z").split("\0");
  const field = fields.find(
    (entry) => entry.startsWith("worktree ") && entry !== `worktree ${project}`,
  );
  if (!field) throw new Error("No linked worktree");
  return field.slice(9);
}

test("branch pickers search and create branches and worktrees from the chosen parent", async () => {
  git(project, "switch", "-c", "feature/parent");
  writeFileSync(path.join(project, "parent.txt"), "Only on the parent\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "parent commit");
  const parent = git(project, "rev-parse", "HEAD");
  git(project, "switch", "main");
  const main = git(project, "rev-parse", "HEAD");
  const { page } = await start([reply("Ready.")]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await gitAction(page, "Switch branch");
  const confirmation = page.getByRole("alertdialog");
  await confirmation.getByLabel("Git branch", { exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search branches", exact: true });
  await expect(search).toBeFocused();
  await search.fill("no-such-branch");
  await expect(page.getByText("No branches found.", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("PARENT");
  await expect(page.getByRole("option")).toHaveText(["feature/parent"]);
  await captureThemes(page, "branch-search");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  expect(git(project, "branch", "--show-current")).toBe("main");
  await submit("Switch branch");
  await expectBranch(page, "feature/parent");
  await pickBranch(page, "main");
  await submit("Switch branch");
  await expectBranch(page, "main");

  await gitAction(page, "New branch");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Parent branch", { exact: true })).toHaveText("main");
  await dialog.getByLabel("Branch name", { exact: true }).fill("feature/child");
  await chooseBranch(dialog, "Parent branch", "feature/parent");
  await captureThemes(page, "new-branch");
  await submit("Create branch");
  await expectBranch(page, "feature/child");
  expect(git(project, "rev-parse", "HEAD")).toBe(parent);
  expect(readFileSync(path.join(project, "parent.txt"), "utf8")).toContain("Only on the parent");

  await gitAction(page, "New worktree");
  await expect(dialog.getByLabel("Base branch", { exact: true })).toHaveText("feature/child");
  await dialog.getByLabel("Branch name", { exact: true }).fill("feature/worktree");
  await chooseBranch(dialog, "Base branch", "main");
  await captureThemes(page, "worktree-base");
  await submit("Create worktree thread");
  await expectBranch(page, "feature/worktree");
  const checkout = worktreePath();
  expect(git(checkout, "rev-parse", "HEAD")).toBe(main);
  expect(existsSync(path.join(checkout, "parent.txt"))).toBe(false);
  expect(git(project, "branch", "--show-current")).toBe("feature/child");
  expect(errors).toEqual([]);
});

test("worktree sidebar markers remain on inactive threads after reload and restart", async () => {
  const first = await start([reply("Ready.")]);
  let { page } = first;
  await composer(page).fill("Local draft");
  await expect(threadRows(page)).toHaveCount(1);
  const localId = await threadRows(page).first().getAttribute("data-thread-id");
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("feature/marked");
  await submit("Create worktree thread");
  await expectBranch(page, "feature/marked");
  await composer(page).fill("Worktree draft");
  await expect(threadRows(page)).toHaveCount(2);
  const marked = threadRows(page).filter({
    has: page.getByRole("img", { name: "Worktree", exact: true }),
  });
  await expect(marked).toHaveCount(1);
  const worktreeId = await marked.getAttribute("data-thread-id");
  const expectMarkers = async () => {
    await expect(
      page
        .locator(`button[data-thread-id="${worktreeId}"]`)
        .getByRole("img", { name: "Worktree", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(`button[data-thread-id="${localId}"]`)
        .getByRole("img", { name: "Worktree", exact: true }),
    ).toHaveCount(0);
  };
  await page.locator(`button[data-thread-id="${localId}"]`).click();
  await expectBranch(page, "main");
  await expectMarkers();
  await page.reload();
  await waitForPi(page);
  await expectMarkers();
  await first.close();
  tondo = await launchTondo({ profileDir: first.profileDir, env });
  page = tondo.page;
  await bringToFront(tondo);
  await waitForPi(page);
  await expectBranch(page, "main");
  await expectMarkers();
  await captureThemes(page, "inactive-worktree");
});

test("status labels and the PR link update without opening Git actions or Changes", async () => {
  writeFileSync(path.join(dir, "created"), "yes");
  writeFileSync(path.join(dir, "pr-branch"), "main");
  const { page, app } = await start([reply("Ready.")]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const pill = gitPill(page);
  const pr = pill.getByRole("link", { name: "PR 7", exact: true });
  await expect(pr).toBeVisible();
  await expect(pr).toHaveAttribute("href", "https://github.example.com/team/repo/pull/7");
  const opened = await captureOpenExternal(app);
  await pr.click();
  expect(await opened()).toBe("https://github.example.com/team/repo/pull/7");
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe("tondo://app/");
  await expect(pill).toContainText("No changes");
  await expect(pill).toContainText("Up to date with origin/main");
  writeFileSync(path.join(project, "new.txt"), "new\n");
  await expect(pill).toContainText("1 change");
  writeFileSync(path.join(project, "README.md"), "Changed\n");
  await expect(pill).toContainText("2 changes");
  git(project, "add", ".");
  git(project, "commit", "-m", "local edits");
  await expect(pill).toContainText("No changes");
  await expect(pill).toContainText("1 ahead of origin/main");
  pushFromElsewhere("remote.txt", "remote\n");
  git(project, "fetch", "origin");
  await expect(pill).toContainText("1 ahead, 1 behind origin/main");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("status-pr-dark.png"),
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: light)").matches))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("status-pr-light.png"),
    animations: "disabled",
  });
  git(project, "switch", "-c", "other");
  await expectBranch(page, "other");
  await expect(pr).toHaveCount(0);
  git(project, "switch", "main");
  await expectBranch(page, "main");
  await expect(pr).toBeVisible();
  await page.reload();
  await waitForPi(page);
  await expect(pr).toBeVisible();
  await expect(pill).toContainText("1 ahead, 1 behind origin/main");
  expect(errors).toEqual([]);
});

test("the worktree directory setting affects new checkouts, survives restart and leaves old checkouts removable", async () => {
  test.setTimeout(90_000);
  const first = await start([bashCall("pwd"), reply("Working in the custom folder.")]);
  let { page } = first;
  const errors: string[] = [];
  const watchErrors = (target: Page) => {
    target.on("pageerror", (error) => errors.push(error.message));
    target.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watchErrors(page);
  const settingsFile = path.join(first.profileDir, "settings.json");
  const saved = () => JSON.parse(readFileSync(settingsFile, "utf8"));
  const customRoot = path.join(dir, "custom worktrees");
  const nextRoot = path.join(dir, "other worktrees");
  mkdirSync(customRoot);
  mkdirSync(nextRoot);

  const openWorktreeSettings = async () => {
    await page.keyboard.press("ControlOrMeta+Comma");
    const settings = page.getByRole("region", { name: "Settings", exact: true });
    await settings
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Threads", exact: true })
      .click();
    await expect(settings.getByText("Worktree location", { exact: true })).toBeVisible();
    return settings;
  };
  const back = async () => {
    await page.locator("header").getByRole("button", { name: "Back", exact: true }).click();
    await waitForPi(page);
  };
  const create = async (branch: string) => {
    await gitAction(page, "New worktree");
    await page.getByLabel("Branch name", { exact: true }).fill(branch);
    await submit("Create worktree thread");
    await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
    await waitForPi(page);
    await expectBranch(page, branch);
    return worktreePath();
  };
  const remove = async () => {
    await gitAction(page, "Remove worktree");
    await submit("Remove worktree");
    await page.getByRole("button", { name: "New thread in project", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
    await waitForPi(page);
    await expectBranch(page, "main");
  };

  let settings = await openWorktreeSettings();
  await expect(
    settings.getByText("Default: worktrees in Tondo's app data folder.", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: "Use default", exact: true })).toHaveCount(0);
  await first.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await settings.getByRole("button", { name: "Choose folder…", exact: true }).click();
  // A second dialog request proves cancellation released the host's in-flight guard.
  await answerFolderDialog(first.app, customRoot);
  await settings.getByRole("button", { name: "Choose folder…", exact: true }).click();
  await expect.poll(() => saved().worktreeDirectory).toBe(customRoot);
  await expect(settings.getByText(customRoot, { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: test.info().outputPath("worktree-settings-light.png"),
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: test.info().outputPath("worktree-settings-dark.png"),
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: null });
  await page.setViewportSize({ width: 800, height: 600 });
  await settings
    .getByRole("button", { name: "Choose folder…", exact: true })
    .scrollIntoViewIfNeeded();
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath("worktree-settings-custom-small.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await back();
  const checkout = await create("feature/custom-location");
  expect(path.dirname(checkout)).toBe(customRoot);
  await send(page, "Show custom cwd");
  await expect(page.getByText("Working in the custom folder.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await page.getByRole("button", { name: "Done Run pwd", exact: true }).click();
  await expect(page.getByText(checkout, { exact: true })).toBeVisible();

  settings = await openWorktreeSettings();
  await answerFolderDialog(first.app, nextRoot);
  await settings.getByRole("button", { name: "Choose folder…", exact: true }).click();
  await expect.poll(() => saved().worktreeDirectory).toBe(nextRoot);
  expect(existsSync(checkout)).toBe(true);
  await back();
  await first.close();
  tondo = await launchTondo({ profileDir: first.profileDir, env });
  page = tondo.page;
  watchErrors(page);
  await bringToFront(tondo);
  await waitForPi(page);
  await expectBranch(page, "feature/custom-location");
  await page.getByRole("button", { name: "Done Run pwd", exact: true }).click();
  await expect(page.getByText(checkout, { exact: true })).toBeVisible();
  settings = await openWorktreeSettings();
  await expect(settings.getByText(nextRoot, { exact: true })).toBeVisible();
  await back();
  await remove();
  expect(existsSync(checkout)).toBe(false);
  expect(git(project, "branch", "--list", "feature/custom-location")).toContain(
    "feature/custom-location",
  );

  const secondCheckout = await create("feature/next-location");
  expect(path.dirname(secondCheckout)).toBe(nextRoot);
  settings = await openWorktreeSettings();
  await settings.getByRole("button", { name: "Use default", exact: true }).click();
  await expect.poll(() => saved().worktreeDirectory).toBeUndefined();
  await expect(settings.getByRole("button", { name: "Choose folder…", exact: true })).toBeFocused();
  await expect(settings.getByRole("button", { name: "Use default", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 800, height: 600 });
  await settings
    .getByRole("button", { name: "Choose folder…", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("worktree-settings-default-small.png"),
    animations: "disabled",
  });
  await back();
  await remove();
  expect(existsSync(secondCheckout)).toBe(false);
  const defaultCheckout = await create("feature/default-location");
  expect(path.dirname(defaultCheckout)).toBe(path.join(first.profileDir, "worktrees"));
  expect(errors).toEqual([]);
});

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
  await expect(gitPill(page).getByRole("link", { name: "PR 7", exact: true })).toBeVisible();
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
    "Pull",
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

test("Pull fast-forwards to the upstream and says what came in, and a diverged branch stays put", async () => {
  const { page } = await start([reply("Hello")]);
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
  const theirs = pushFromElsewhere("teammate.txt", "from a teammate\n");
  await gitAction(page, "Pull");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Pull branch", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Fetch origin/main and fast-forward main to it.");
  await page.screenshot({ path: "test-results/git-pull.png" });
  await submit("Pull branch");
  expect(git(project, "rev-parse", "HEAD")).toBe(theirs);
  expect(readFileSync(path.join(project, "teammate.txt"), "utf8")).toBe("from a teammate\n");
  await expect(toast("Pulled origin/main into main.")).toBeVisible();
  await gitAction(page, "Pull");
  await submit("Pull branch");
  await expect(toast("Already up to date with origin/main.")).toBeVisible();

  // With a local commit and a newer one on the remote, no fast-forward is possible, so nothing moves.
  pushFromElsewhere("second.txt", "second\n");
  writeFileSync(path.join(project, "local.txt"), "local\n");
  git(project, "add", "local.txt");
  git(project, "commit", "-m", "local");
  const local = git(project, "rev-parse", "HEAD");
  await gitAction(page, "Pull");
  await dialog.getByRole("button", { name: "Pull branch", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Not possible to fast-forward");
  await page.screenshot({ path: "test-results/git-pull-diverged.png" });
  expect(git(project, "rev-parse", "HEAD")).toBe(local);
  expect(existsSync(path.join(project, "second.txt"))).toBe(false);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The pull's fetch still ran, so the pill now counts the remote's commit.
  await expect(gitPill(page)).toContainText("1 ahead, 1 behind origin/main");

  // A branch with no upstream has nothing to pull from.
  git(project, "switch", "-c", "topic");
  await gitAction(page, "Refresh");
  await expectBranch(page, "topic");
  await expectGitAction(page, "Pull", false);
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

test("worktrees can be created from new and running threads while the local checkout stays busy", async () => {
  test.setTimeout(90_000);
  const release = path.join(dir, "release");
  const held = waitForFileCommand(release);
  const command = `pwd > cwd-proof.txt; if [ "$PWD" = "${project}" ]; then printf 'Local edits\\n' > README.md; ${held}; else printf 'Separate edits\\n' > separate.txt; fi`;
  const { page } = await start([bashCall(command, "held-checkout"), reply("Checkout finished.")]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const head = git(project, "rev-parse", "HEAD");
  const index = git(project, "ls-files", "--stage");
  await send(page, "Local work in progress");
  await expect(page.locator('[data-tool-call="held-checkout"]')).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect
    .poll(() => readFileSync(path.join(project, "README.md"), "utf8"))
    .toBe("Local edits\n");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("$");
  await page.getByRole("button", { name: "project", exact: true }).hover();
  await page.getByRole("button", { name: "New thread in project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New thread", exact: true })).toBeVisible();
  await waitForPi(page);
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("parallel-from-new");
  await submit("Create worktree thread");
  await expectBranch(page, "parallel-from-new");
  await waitForPi(page);
  const checkout = worktreePath();
  expect(readFileSync(path.join(checkout, "README.md"), "utf8")).toBe("Initial\n");
  await send(page, "Independent work");
  await expect(page.getByText("Checkout finished.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  expect(readFileSync(path.join(checkout, "cwd-proof.txt"), "utf8").trim()).toBe(checkout);
  expect(readFileSync(path.join(checkout, "separate.txt"), "utf8")).toBe("Separate edits\n");
  expect(existsSync(path.join(project, "separate.txt"))).toBe(false);
  await expect(threadRows(page).filter({ hasText: "Independent work" })).toHaveCount(1);
  const local = threadRows(page).filter({ hasText: "Local work in progress" });
  await expect(local.getByLabel("Working", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("parallel-worktree.png"),
    animations: "disabled",
  });
  await local.click();
  await expect(
    page.getByRole("heading", { name: "Local work in progress", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-tool-call="held-checkout"]')).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeVisible();
  // Creating directly from the running thread is safe too, even with its shell open.
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("parallel-from-running");
  await submit("Create worktree thread");
  await expectBranch(page, "parallel-from-running");
  expect(git(project, "branch", "--show-current")).toBe("main");
  expect(git(project, "rev-parse", "HEAD")).toBe(head);
  expect(git(project, "ls-files", "--stage")).toBe(index);
  expect(readFileSync(path.join(project, "README.md"), "utf8")).toBe("Local edits\n");
  writeFileSync(release, "go");
  await local.click();
  await expect(page.getByText("Checkout finished.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  expect(errors).toEqual([]);
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
  // main has an upstream, but Git can't pull in the middle of a merge.
  await expectGitAction(page, "Pull", false);
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
