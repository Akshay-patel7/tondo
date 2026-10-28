import type { UserMessage } from "@earendil-works/pi-ai";
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { processesIn, reportProcesses } from "./processes";
import {
  addProject,
  composer,
  launchWithPi,
  reply,
  send,
  threadRows,
  threads,
  waitForIdle,
  waitForPi,
} from "./pi";
import { pickerOptions } from "./ui";

/** Where the accounts work's QA screenshots go. */
const ACCOUNTS_QA = path.resolve(__dirname, "../.dev/improvements-20261011/qa/accounts");

let workDir: string;
let project: string;
let tondo: Tondo;

test.beforeEach(async () => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-terminal-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
  tondo = await launchWithPi({
    workDir,
    script: {
      recordInputs: path.join(workDir, "inputs.json"),
      responses: [reply("Ready."), reply("Ready.")],
    },
  });
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

/** The text of each row in view. xterm's accessibility tree mirrors the viewport, not the scrollback. */
function visibleRows() {
  return tondo.page.locator(".xterm-accessibility-tree > div").allTextContents();
}

/** Drags the drawer's grip to the window's `edge`; the drawer clamps the height it ends at. */
async function dragGrip(edge: "top" | "bottom") {
  const bounds = (await tondo.page
    .getByRole("separator", { name: "Resize terminal" })
    .boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await tondo.page.mouse.move(x, y);
  await tondo.page.mouse.down();
  const bottom = await tondo.page.evaluate(() => window.innerHeight - 1);
  await tondo.page.mouse.move(x, edge === "top" ? 0 : bottom, { steps: 5 });
  await tondo.page.mouse.up();
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

test("shell output stays out of chat and the sharing controls are gone", async () => {
  const { page } = tondo;
  const inputs = path.join(workDir, "inputs.json");
  const lastInput = () => {
    const messages = JSON.parse(readFileSync(inputs, "utf8")) as UserMessage[];
    const content = messages.at(-1)?.content;
    return typeof content === "string"
      ? content
      : content
          ?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  };
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("printf 'PRIVATE_%s\\n' OUTPUT");
  await expect(output()).toContainText("PRIVATE_OUTPUT");
  expect(existsSync(inputs)).toBe(false);
  await expect(page.getByRole("switch", { name: "Share terminal output with chat" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("group", { name: "Pending terminal output" })).toHaveCount(0);
  await send(page, "Discuss this without terminal output.");
  await waitForIdle(page);
  expect(lastInput()).toBe("Discuss this without terminal output.");
  for (const scheme of ["light", "dark"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- capture both themes on the same window.
    await page.emulateMedia({ colorScheme: scheme });
    // oxlint-disable-next-line eslint/no-await-in-loop -- inspect each theme before changing it.
    await page.screenshot({ path: test.info().outputPath(`terminal-no-sharing-${scheme}.png`) });
  }
  await page.reload();
  await waitForPi(page);
  await expect(output()).toContainText("PRIVATE_OUTPUT");
  await command("printf 'AFTER_%s\\n' RELOAD");
  await expect(output()).toContainText("AFTER_RELOAD");
  await expect(page.getByRole("switch", { name: "Share terminal output with chat" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("group", { name: "Pending terminal output" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await send(page, "Closing the shell does not attach its history.");
  await waitForIdle(page);
  expect(lastInput()).toBe("Closing the shell does not attach its history.");
});

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
  // Start from the shortest drawer: in a small window the tallest one must
  // leave the thread its transcript, so there may be little room to grow.
  const grip = page.getByRole("separator", { name: "Resize terminal" });
  await dragGrip("bottom");
  await expect(grip).toHaveAttribute("aria-valuenow", "160");
  await command('stty size | awk \'{print "SIZE=" $1 ":" $2}\'');
  await expect(output()).toContainText(/SIZE=\d+:\d+/);
  const before = /SIZE=(\d+):(\d+)/.exec(await output().innerText())!;
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

test("large output stays available to copy after resizing, switching threads and reloading", async () => {
  const { app, page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const padding = "x".repeat(64);
  await command(
    `awk 'BEGIN { for (i=0; i<12000; i++) printf "TONDO_LINE_%05d ${padding}\\n", i; printf "TONDO_LARGE_%s\\n", "DONE" }'`,
  );
  await expect(output()).toContainText("TONDO_LARGE_DONE");

  const scrollToStart = async () => {
    await page.locator(".xterm-screen").hover();
    const scrollbar = page.locator(".xterm .scrollbar.vertical");
    const track = (await scrollbar.boundingBox())!;
    const thumb = (await scrollbar.locator(".slider").boundingBox())!;
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, track.y, { steps: 5 });
    await page.mouse.up();
    await expect(output()).toContainText("TONDO_LINE_00000");
  };
  await scrollToStart();
  await page.screenshot({ path: "test-results/terminal-large-output-top.png" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1_440, 900));
  await page.waitForFunction(() => window.innerWidth === 1_440);
  await scrollToStart();

  await composer(page).fill("Keep terminal history");
  await composer(page).press("ControlOrMeta+n");
  await waitForPi(page);
  await threads(page).locator("button[data-thread-id]:not([aria-current])").click();
  await expect(output()).toContainText("TONDO_LARGE_DONE");
  await scrollToStart();
  await page.reload();
  await expect(output()).toContainText("TONDO_LARGE_DONE");
  await scrollToStart();

  // xterm has a Select All shortcut on macOS only. Exercise the full
  // terminal-to-composer clipboard path there; retention is checked on both OSes.
  if (process.platform !== "darwin") return;
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
    await clipboard.writeText("");
  });
  try {
    const input = page.locator(".xterm-helper-textarea");
    await input.focus();
    await input.press("Meta+a");
    await input.press("Meta+c");
    await expect
      .poll(() =>
        app.evaluate(
          async ({ clipboard }) =>
            (await clipboard.readText()).match(/TONDO_LINE_\d{5}/g)?.length ?? 0,
        ),
      )
      .toBe(12_000);
    expect(
      await app.evaluate(async ({ clipboard }, linePadding) => {
        const lines = (await clipboard.readText())
          .split(/\r?\n/)
          .filter((line) => /^TONDO_LINE_\d{5} /.test(line));
        return lines.every(
          (line, i) => line === `TONDO_LINE_${String(i).padStart(5, "0")} ${linePadding}`,
        );
      }, padding),
    ).toBe(true);
    await composer(page).fill("");
    await composer(page).focus();
    await page.keyboard.press("Meta+v");
    await expect
      .poll(() =>
        composer(page).evaluate(
          (element) => element.textContent?.match(/TONDO_LINE_\d{5}/g)?.length ?? 0,
        ),
      )
      .toBe(12_000);
    await expect(composer(page)).toContainText(`TONDO_LINE_00000 ${padding}`);
    await expect(composer(page)).toContainText(`TONDO_LINE_11999 ${padding}`);
    await page.screenshot({ path: "test-results/terminal-large-output-pasted.png" });
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

test("text inserted without a keydown, as by the emoji picker or dictation, reaches the shell", async () => {
  const { page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  const file = path.join(workDir, "inserted");
  await command(`cat > '${file}'`);
  // The shell creates the file before cat starts reading the terminal.
  await expect.poll(() => existsSync(file)).toBe(true);
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.insertText("abc é 👍 漢字");
  await input.press("Enter");
  await input.press("Control+d");
  await expect.poll(() => readFileSync(file, "utf8")).toBe("abc é 👍 漢字\n");
});

test("Terminal starts a new shell in place of one that exited", async () => {
  const { page } = tondo;
  const opener = page.getByRole("button", { name: "Terminal", exact: true });
  const status = page.getByRole("region", { name: "Terminal", exact: true }).getByRole("status");
  await opener.click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("exit 3");
  await expect(status).toHaveText("Exited (3)");
  await opener.click();
  await expect(status).toHaveText("");
  await command("printf 'FRESH_%s\\n' SHELL");
  await expect(output()).toContainText("FRESH_SHELL");
});

test("at the minimum window size the tallest terminal leaves the transcript and a whole footer", async () => {
  const { app, page } = tondo;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(840, 620));
  await page.waitForFunction(() => window.innerWidth === 840 && window.innerHeight === 620);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const grip = page.getByRole("separator", { name: "Resize terminal" });
  await expect(grip).toBeVisible();
  await dragGrip("top");
  const tallest = await grip.getAttribute("aria-valuemax");
  await expect(grip).toHaveAttribute("aria-valuenow", tallest!);
  const layout = await page.evaluate(() => {
    const footer = document.querySelector(
      'section[aria-label="Terminal"]',
    )!.previousElementSibling!;
    const bounds = footer.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(footer).paddingBottom);
    return {
      transcript: footer.previousElementSibling!.getBoundingClientRect().height,
      contentBottom: footer.firstElementChild!.getBoundingClientRect().bottom,
      footerContentEnd: bounds.bottom - padding,
    };
  });
  await page.screenshot({ path: "test-results/terminal-tallest-minimum.png" });
  expect(layout.transcript, "the transcript keeps its room").toBeGreaterThanOrEqual(119);
  expect(layout.contentBottom, "the footer is cut off").toBeLessThanOrEqual(
    layout.footerContentEnd + 0.5,
  );
});

test("provider sign-in runs a separate interactive pi in the isolated profile", async () => {
  const { page } = tondo;
  // pi can use the faux model with nothing saved in auth.json, so it says
  // you're signed in, and the header offers no sign-in. /login still opens it.
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign in to a provider" })).toHaveCount(0);
  await page.screenshot({
    path: path.join(ACCOUNTS_QA, "header-signed-in-nothing-saved.png"),
    animations: "disabled",
  });
  await send(page, "/login");
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expect(output()).toContainText("faux", { timeout: 30_000 });
  await command("/login");
  await expect(output()).toContainText("Select authentication method");
  await page.locator(".xterm-helper-textarea").press("ArrowDown");
  await page.locator(".xterm-helper-textarea").press("Enter");
  // pi's provider list ends with a count line such as "(1/40)", so it has been drawn.
  await expect(output()).toContainText(/\(1\/\d+\)/);
  // In a drawer too short for the list, its title and first provider scroll out of view.
  await expect
    .poll(visibleRows)
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining("Select provider to configure:"),
        expect.stringContaining("→ Amazon Bedrock"),
      ]),
    );
  await page.screenshot({ path: "test-results/terminal-login.png" });
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
  await expect
    .poll(async () => (await pickerOptions(page, "Model")).some((name) => name.includes("Claude")))
    .toBe(true);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await page.screenshot({ path: "test-results/terminal-login-closed.png" });
});

test("switching threads retains each shell, and clipboard paste reaches the terminal", async () => {
  const { app, page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("export TONDO_TERMINAL_TEST=first; printf 'FIRST_%s\\n' READY");
  await expect(output()).toContainText("FIRST_READY");
  await composer(page).fill("First shell");
  await composer(page).focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+n" : "Control+n");
  await expect(threadRows(page)).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await waitForPi(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("printf 'SECOND=%s\\n' \"${TONDO_TERMINAL_TEST:-empty}\"");
  await expect(output()).toContainText("SECOND=empty");
  await composer(page).fill("Second shell");
  await expect(threadRows(page)).toHaveCount(2);
  await page.locator("nav button[data-thread-id]:not([aria-current])").click();
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

test("focus goes back to the Terminal button when the drawer closes or leaves with focus", async () => {
  const { page } = tondo;
  const isMac = process.platform === "darwin";
  const opener = page.getByRole("button", { name: "Terminal", exact: true });
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  const input = page.locator(".xterm-helper-textarea");
  await opener.click();
  await command("printf 'FOCUS_%s\\n' READY");
  await expect(output()).toContainText("FOCUS_READY");
  // On Linux, Ctrl+K inside xterm belongs to the shell, so the palette opens
  // from the drawer's resize grip there.
  const inside = isMac ? input : page.getByRole("separator", { name: "Resize terminal" });
  await inside.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("combobox", { name: "Search" })).toBeFocused();
  await page.keyboard.type("Close terminal");
  await expect(palette.getByRole("option", { selected: true })).toContainText("Close terminal");
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();

  // A draft keeps this thread from being forgotten as unused when Mod+N leaves it.
  await composer(page).pressSequentially("keep");
  await page.keyboard.press("ControlOrMeta+n");
  await expect(threadRows(page)).toHaveCount(1);
  await waitForPi(page);
  await opener.click();
  await command("printf 'JUMP_%s\\n' READY");
  await expect(output()).toContainText("JUMP_READY");
  await composer(page).fill("Second shell");
  await expect(threadRows(page)).toHaveCount(2);
  const other = await threadRows(page).evaluateAll((rows) =>
    rows.findIndex((row) => !row.hasAttribute("aria-current")),
  );
  await input.focus();
  await page.keyboard.press(`ControlOrMeta+${other + 1}`);
  if (isMac) {
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  } else {
    // Linux leaves Ctrl+1..9 to the shell, so the terminal keeps focus.
    await expect(input).toBeFocused();
    await expect(drawer).toBeVisible();
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

test("/login starts a sign-in terminal in place of a shell that exited", async () => {
  const { page } = tondo;
  const status = page.getByRole("region", { name: "Terminal", exact: true }).getByRole("status");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  await command("exit 3");
  await expect(status).toHaveText("Exited (3)");
  await send(page, "/login");
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await expect(status).toHaveText("");
  await expect(output()).toContainText("faux", { timeout: 30_000 });
});

test("confirmed deletion stops its terminal's shell and background jobs", async () => {
  const { page } = tondo;
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
  const pids = path.join(workDir, "deleted-pids");
  await command(`echo $$ > '${pids}'; sleep 401 & echo $! >> '${pids}'`);
  await expect
    .poll(() => (existsSync(pids) ? readFileSync(pids, "utf8").trim().split("\n").length : 0))
    .toBe(2);
  // The shell leads its process group, and job control gives the background sleep its own.
  const groups = readFileSync(pids, "utf8").trim().split("\n").map(Number);
  expect(processesIn(groups)).not.toEqual([]);

  // A draft keeps the first thread listed. Mod+N from the composer, since xterm may take it.
  await composer(page).pressSequentially("keep");
  await page.keyboard.press("ControlOrMeta+n");
  await expect(threadRows(page)).toHaveCount(1);
  await waitForPi(page);
  await threads(page)
    .locator("button[data-thread-id]:not([aria-current])")
    .click({ button: "right" });
  await page
    .getByRole("menu", { name: "Thread actions" })
    .getByRole("menuitem", { name: "Delete…", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(processesIn(groups)).not.toEqual([]);
  await threads(page)
    .locator("button[data-thread-id]:not([aria-current])")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…", exact: true }).click();
  await page.screenshot({
    path: ".dev/improvements-20261011/qa/deletion/terminal-confirmation.png",
  });
  await confirmation.getByRole("button", { name: "Delete thread", exact: true }).click();
  await expect(threadRows(page)).toHaveCount(0);
  await expect.poll(() => processesIn(groups)).toEqual([]);
  reportProcesses("deletion-terminal-processes.txt", { afterDelete: processesIn(groups) });
});
