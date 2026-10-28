import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  launchWithPi,
  reply,
  send,
  waitForIdle,
  waitForPi,
  threadRows,
} from "./pi";
import { pickOption } from "./ui";

let dir: string;
let project: string;
let profileDir: string;
let env: Record<string, string>;
let tondo: Tondo;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-scripts-")));
  project = path.join(dir, "project's app");
  profileDir = path.join(dir, "profile");
  mkdirSync(project);
  mkdirSync(profileDir);
  env = {
    HOME: dir,
    PATH: process.env.PATH!,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    CONTEXT_MODE_DATA_DIR: path.join(dir, "context"),
  };
  const shell = path.join(dir, "shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n',
  );
  chmodSync(shell, 0o755);
  env.SHELL = shell;
  git(project, "init", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.com");
  git(project, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, "README.md"), "Initial\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "initial");
});

test.afterEach(async () => {
  await tondo?.close();
  rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function proof() {
  const file = path.join(dir, "runs.jsonl");
  const js =
    'const fs=require("fs");const branch=require("child_process").execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim();fs.appendFileSync(process.argv[1],JSON.stringify({cwd:process.cwd(),branch})+"\\n");console.log("BUILD_OK");';
  return {
    command: `${quote(process.execPath)} -e ${quote(js)} ${quote(file)}`,
    runs: () =>
      existsSync(file)
        ? readFileSync(file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { cwd: string; branch: string })
        : [],
  };
}

async function run(page: Page, name = "Build app") {
  await expect(page.getByRole("button", { name: "Project scripts", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Project scripts", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function configure(page: Page) {
  await page.getByRole("button", { name: "Project scripts", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure scripts…", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project scripts", exact: true })).toBeVisible();
}

async function capture(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: null });
  const take = async (theme: "light" | "dark") => {
    await tondo.app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source as "light" | "dark";
    }, theme);
    await page.waitForFunction(
      (source) => matchMedia("(prefers-color-scheme: dark)").matches === (source === "dark"),
      theme,
    );
    // Electron keeps the whole window in frame at non-default zoom.
    const shot = await tondo.app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    writeFileSync(test.info().outputPath(`${name}-${theme}.png`), Buffer.from(shot, "base64"));
  };
  await take("light");
  await take("dark");
}

async function shellCommand(page: Page, command: string) {
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await input.pressSequentially(command);
  await input.press("Enter");
}

const output = (page: Page) => page.locator(".xterm-accessibility-tree");

test("scripts can be configured, edited and deleted, run separately, survive reload and restart, and stay per-project", async () => {
  test.setTimeout(60_000);
  const build = proof();
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    env,
    script: { responses: [reply("Ready.")] },
  });
  let { page } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Local script thread");
  await waitForIdle(page);
  await configure(page);
  await page.getByRole("button", { name: "Add script", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Save script" })).toBeDisabled();
  await dialog.getByLabel("Name", { exact: true }).fill("Build");
  await dialog.getByLabel("Command", { exact: true }).fill(build.command);
  await dialog.getByRole("button", { name: "Save script" }).click();
  await page.getByRole("button", { name: "Edit Build", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Build app");
  await dialog.getByRole("button", { name: "Save script" }).click();
  const saved = () => JSON.parse(readFileSync(path.join(profileDir, "settings.json"), "utf8"));
  await expect.poll(() => saved().projectScripts?.[project]?.[0]?.name).toBe("Build app");
  await capture(page, "settings");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await shellCommand(page, "printf 'SHELL_%s\\n' UNTOUCHED");
  await expect(output(page)).toContainText("SHELL_UNTOUCHED");
  await page.getByRole("button", { name: "Run Build app", exact: true }).click();
  await expect.poll(() => build.runs().length).toBe(1);
  expect(build.runs()[0]).toEqual({ cwd: project, branch: "main" });
  await expect(output(page)).toContainText("BUILD_OK");
  await expect(page.getByRole("status").filter({ hasText: "Exited (0)" })).toBeVisible();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(output(page)).toContainText("SHELL_UNTOUCHED");
  await run(page);
  await expect.poll(() => build.runs().length).toBe(2);
  await page.reload();
  await waitForPi(page);
  await expect(output(page)).toContainText("BUILD_OK");
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(output(page)).toContainText("BUILD_OK");
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(output(page)).toContainText("SHELL_UNTOUCHED");
  await configure(page);
  await page.getByRole("button", { name: "Add script", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Fail build");
  await dialog.getByLabel("Command", { exact: true }).fill("printf 'BUILD_FAILED\\n'; exit 7");
  await dialog.getByRole("button", { name: "Save script" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await run(page, "Fail build");
  await expect(output(page)).toContainText("BUILD_FAILED");
  await expect(page.getByRole("status").filter({ hasText: "Exited (7)" })).toBeVisible();
  await capture(page, "failed-script");
  await configure(page);
  await page.getByRole("button", { name: "Delete Fail build", exact: true }).click();
  await expect.poll(() => saved().projectScripts[project].length).toBe(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const other = path.join(dir, "other-project");
  mkdirSync(other);
  await addProject(tondo, other);
  await expect(page.locator("header").getByText("other-project", { exact: true })).toBeVisible();
  await waitForPi(page);
  await expect(page.getByRole("button", { name: "Project scripts", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Project scripts", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Build app", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.getByRole("button", { name: "Local script thread", exact: true }).click();
  await waitForPi(page);
  await tondo.close();
  tondo = await launchTondo({ profileDir, env });
  page = tondo.page;
  await bringToFront(tondo);
  await waitForPi(page);
  await run(page);
  await expect.poll(() => build.runs().length).toBe(3);
  expect(build.runs()[2]).toEqual({ cwd: project, branch: "main" });
  await expect(output(page)).toContainText("BUILD_OK");
  await capture(page, "header-terminal");
  expect(errors).toEqual([]);
});

test("scripts follow managed and detected agent worktrees while the normal shell stays in its original checkout", async () => {
  test.setTimeout(60_000);
  const build = proof();
  const agent = path.join(dir, "agent's checkout");
  git(project, "worktree", "add", "-b", "agent/topic", agent);
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    env,
    settings: {
      projectScripts: { [project]: [{ id: "build", name: "Build app", command: build.command }] },
    },
    script: { responses: [bashCall(`cd ${quote(agent)} && pwd`), reply("Agent checkout used.")] },
  });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Git actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "New worktree", exact: true }).click();
  await page.getByLabel("Branch name", { exact: true }).fill("scripts/managed");
  await page.getByRole("button", { name: "Create worktree thread", exact: true }).click();
  await expect(page.locator("header")).toContainText("Branch scripts/managed");
  await waitForPi(page);
  await run(page);
  await expect.poll(() => build.runs().length).toBe(1);
  await expect(threadRows(page)).toHaveCount(1);
  const managed = build.runs()[0]!.cwd;
  expect(managed).not.toBe(project);
  expect(build.runs()[0]!.branch).toBe("scripts/managed");
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await send(page, "Use the agent checkout");
  await expect(page.getByText("Agent checkout used.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await expect(page.locator("header")).toContainText("Branch agent/topic");
  await run(page);
  await expect.poll(() => build.runs().length).toBe(2);
  expect(build.runs()[1]).toEqual({ cwd: agent, branch: "agent/topic" });
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await shellCommand(page, "pwd");
  await expect(output(page)).toContainText(managed);
  await pickOption(page, "Select terminal", "Build app · 2");
  await expect(output(page)).toContainText("BUILD_OK");
  await capture(page, "agent-checkout");
  await tondo.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(840, 620),
  );
  await page.waitForFunction(() => window.innerWidth === 840);
  const headerFits = () =>
    page.locator("header").evaluate((header) => header.scrollWidth <= header.clientWidth);
  await expect.poll(headerFits).toBe(true);
  expect(
    (await page.getByRole("combobox", { name: "Select terminal", exact: true }).boundingBox())!
      .width,
  ).toBeGreaterThanOrEqual(190);
  await capture(page, "minimum");
  await tondo.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setSize(1200, 800);
    window.webContents.setZoomFactor(2);
  });
  await page.waitForFunction(() => window.innerWidth === 600);
  await expect.poll(headerFits).toBe(true);
  await capture(page, "zoomed");
  expect(git(project, "branch", "--show-current")).toBe("main");
  expect(git(managed, "branch", "--show-current")).toBe("scripts/managed");
});

test("closing a selected script through the palette stops its descendants without closing the shell, and quit stops later runs", async () => {
  const pids = path.join(dir, "script-pids.json");
  const js =
    'const fs=require("fs");const child=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));console.log("SCRIPT_RUNNING");setInterval(()=>{},1000);';
  const command = `${quote(process.execPath)} -e ${quote(js)} ${quote(pids)}`;
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    env,
    settings: { projectScripts: { [project]: [{ id: "build", name: "Build app", command }] } },
    script: { responses: [reply("Ready.")] },
  });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await shellCommand(page, "printf 'SHELL_%s\\n' PRESERVED");
  await expect(output(page)).toContainText("SHELL_PRESERVED");
  await run(page);
  await expect(output(page)).toContainText("SCRIPT_RUNNING");
  const first = JSON.parse(readFileSync(pids, "utf8")) as number[];
  expect(first.every(alive)).toBe(true);
  await page.getByRole("button", { name: /^Search/ }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search", exact: true }).fill("Close terminal");
  await palette.getByRole("combobox", { name: "Search", exact: true }).press("Enter");
  await expect(output(page)).toContainText("SHELL_PRESERVED");
  await expect.poll(() => first.some(alive)).toBe(false);
  await run(page);
  await expect(output(page)).toContainText("SCRIPT_RUNNING");
  const second = JSON.parse(readFileSync(pids, "utf8")) as number[];
  expect(second).not.toEqual(first);
  await tondo.close();
  await expect.poll(() => second.some(alive)).toBe(false);
});
