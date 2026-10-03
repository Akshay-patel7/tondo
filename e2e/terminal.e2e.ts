import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { processesIn, reportProcesses } from "./processes";
import { addProject, composer, launchWithPi, reply, send, threadRows, waitForPi } from "./pi";

let workDir: string;
let project: string;
let tondo: Tondo;

test.beforeEach(async () => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-terminal-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
  tondo = await launchWithPi({ workDir, script: { responses: [reply("Ready.")] } });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
});

test.afterEach(async () => {
  await tondo.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function command(text: string) {
  const input = tondo.page.locator(".xterm-helper-textarea");
  await input.focus();
  await input.pressSequentially(text);
  await input.press("Enter");
}

function output() {
  return tondo.page.locator(".xterm-accessibility-tree");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("a real shell runs in the thread folder, resizes, survives reload and closes its jobs", async () => {
  const { page } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("printf 'TONDO_%s\\n' TERMINAL_OK; pwd; printf '%s\\n' \"$TERM\"");
  await expect(output()).toContainText("TONDO_TERMINAL_OK");
  await expect(output()).toContainText(project);
  await expect(output()).toContainText("xterm-256color");
  const overflow = await page.locator("[data-terminal-view]").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const screen = element.querySelector(".xterm-screen")!.getBoundingClientRect();
    return Math.max(screen.bottom - bounds.bottom, screen.right - bounds.right);
  });
  expect(overflow, "xterm's last row and column must fit inside its view").toBeLessThanOrEqual(0);
  await command('stty size | awk \'{print "SIZE=" $1 ":" $2}\'');
  await expect(output()).toContainText(/SIZE=\d+:\d+/);
  const before = /SIZE=(\d+):(\d+)/.exec(await output().innerText())!;
  const grip = page.getByRole("separator", { name: "Resize terminal" });
  await grip.focus();
  await grip.press("ArrowUp");
  await grip.press("ArrowUp");
  await command('stty size | awk \'{print "LARGER=" $1 ":" $2}\'');
  await expect(output()).toContainText(/LARGER=\d+:\d+/);
  const after = /LARGER=(\d+):(\d+)/.exec(await output().innerText())!;
  expect(Number(after[1])).toBeGreaterThan(Number(before[1]));
  expect(Number(after[2])).toBe(Number(before[2]));
  const bounds = (await grip.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 50, { steps: 5 });
  await page.mouse.up();
  await command('stty size | awk \'{print "DRAGGED=" $1 ":" $2}\'');
  await expect(output()).toContainText(/DRAGGED=\d+:\d+/);
  const dragged = /DRAGGED=(\d+):(\d+)/.exec(await output().innerText())!;
  expect(Number(dragged[1])).toBeGreaterThan(Number(after[1]));
  await page.screenshot({ path: "test-results/terminal.png" });
  await page.reload();
  await expect(output()).toContainText("TONDO_TERMINAL_OK");
  await command("printf 'AFTER_%s\\n' RELOAD");
  await expect(output()).toContainText("AFTER_RELOAD");
  const pids = path.join(workDir, "pids");
  await command(`echo $$ > '${pids}'; sleep 120 & echo $! >> '${pids}'; wait`);
  await expect
    .poll(() => (existsSync(pids) ? readFileSync(pids, "utf8").trim().split("\n").length : 0))
    .toBe(2);
  const [shell, child] = readFileSync(pids, "utf8").trim().split("\n").map(Number);
  expect(alive(shell!)).toBe(true);
  expect(alive(child!)).toBe(true);
  const groups = [shell!, child!];
  const beforeClose = processesIn(groups);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await expect.poll(() => [alive(shell!), alive(child!)]).toEqual([false, false]);
  await expect.poll(() => processesIn(groups)).toEqual([]);
  reportProcesses("terminal-processes.txt", { beforeClose, afterClose: processesIn(groups) });
  expect(errors).toEqual([]);
});

test("provider sign-in runs a separate interactive pi in the isolated profile", async () => {
  const { page } = tondo;
  await send(page, "/login");
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expect(output()).toContainText("faux", { timeout: 30_000 });
  await command("/login");
  await expect(output()).toContainText("Select authentication method");
  await page.screenshot({ path: "test-results/terminal-login.png" });
  await page.locator(".xterm-helper-textarea").press("ArrowDown");
  await page.locator(".xterm-helper-textarea").press("Enter");
  await expect(output()).toContainText("Anthropic");
  await page.locator(".xterm-helper-textarea").press("ArrowDown");
  await page.locator(".xterm-helper-textarea").press("ArrowDown");
  await expect(output()).toContainText("→ Anthropic");
  await page.locator(".xterm-helper-textarea").press("Enter");
  await expect(output()).toContainText(/API key/i);
  await command("synthetic-offline-test-key");
  await expect(output()).toContainText("Saved API key for Anthropic");
  const authFile = path.join(tondo.profileDir, "pi-agent", "auth.json");
  expect(JSON.parse(readFileSync(authFile, "utf8"))).toMatchObject({
    anthropic: { type: "api_key", key: "synthetic-offline-test-key" },
  });
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await expect(page.getByLabel("Model").locator("option")).toContainText(["Claude"]);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
});

test("switching threads retains each shell, and clipboard paste reaches the terminal", async () => {
  const { app, page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("export TONDO_TERMINAL_TEST=first; printf 'FIRST_%s\\n' READY");
  await expect(output()).toContainText("FIRST_READY");
  await composer(page).focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+n" : "Control+n");
  await expect(threadRows(page)).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await waitForPi(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("printf 'SECOND=%s\\n' \"${TONDO_TERMINAL_TEST:-empty}\"");
  await expect(output()).toContainText("SECOND=empty");
  await page.locator("nav li > button[title]:not([aria-label]):not([aria-current])").click();
  await expect(output()).toContainText("FIRST_READY");
  await command("printf 'KEPT=%s\\n' \"$TONDO_TERMINAL_TEST\"");
  await expect(output()).toContainText("KEPT=first");
  // Preserve every clipboard format in main; none of its contents enter the test log.
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const state = globalThis as typeof globalThis & {
      terminalClipboard?: Electron.ClipboardItem[];
    };
    state.terminalClipboard = await Promise.all(
      (await clipboard.read())
        .filter((item) => item.types.length > 0)
        .map(
          async (item) =>
            new ClipboardItem(
              Object.fromEntries(
                await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
              ),
            ),
        ),
    );
    await clipboard.writeText("printf 'PASTE_%s\\n' OK");
  });
  try {
    const input = page.locator(".xterm-helper-textarea");
    await input.focus();
    await input.press(process.platform === "darwin" ? "Meta+v" : "Control+Shift+v");
    await input.press("Enter");
    await expect(output()).toContainText("PASTE_OK");
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      const state = globalThis as typeof globalThis & {
        terminalClipboard?: Electron.ClipboardItem[];
      };
      if (state.terminalClipboard?.length) await clipboard.write(state.terminalClipboard);
      else clipboard.clear();
      delete state.terminalClipboard;
    });
  }
});

test("the terminal still works when WebGL is unavailable", async () => {
  const { page } = tondo;
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2") return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  await page.reload();
  await waitForPi(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator("[data-terminal-view]")).toHaveAttribute("data-renderer", "dom");
  await command("printf 'FALLBACK_%s\\n' OK");
  await expect(output()).toContainText("FALLBACK_OK");
});

test("quitting the app stops a terminal's separate job-control group", async () => {
  const { page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  const file = path.join(workDir, "job-pid");
  await command(`sh -c 'trap "" HUP TERM; echo $$ > "${file}"; exec sleep 120' &`);
  await expect
    .poll(() => existsSync(file) && readFileSync(file, "utf8").trim().length > 0)
    .toBe(true);
  const pid = Number(readFileSync(file, "utf8").trim());
  try {
    expect(alive(pid)).toBe(true);
    await tondo.close();
    await expect.poll(() => alive(pid)).toBe(false);
    await expect.poll(() => processesIn([pid])).toEqual([]);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});
