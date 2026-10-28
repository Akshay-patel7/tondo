// oxlint-disable eslint/no-await-in-loop -- gestures share one foreground window and must run in order.
import { expect, test, type Locator } from "@playwright/test";
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
import { bringToFront, type Tondo } from "./launch";
import { addProject, composer, launchWithPi, reply, threadRows, waitForPi } from "./pi";
import { pickOption, pickerOptions } from "./ui";

let workDir: string;
let tondo: Tondo;
test.beforeEach(async () => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-multiple-terminals-")));
  const project = path.join(workDir, "project");
  mkdirSync(project);
  tondo = await launchWithPi({ workDir, script: { responses: [reply("Ready.")] } });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await tondo.page.getByRole("button", { name: "Terminal", exact: true }).click();
});
test.afterEach(async () => {
  await tondo.close();
  rmSync(workDir, { recursive: true, force: true });
});
function pane(name: string) {
  return tondo.page.getByRole("group", { name, exact: true });
}
async function command(target: Locator, text: string) {
  const input = target.locator(".xterm-helper-textarea");
  await expect(input).toBeAttached();
  await input.focus();
  await input.pressSequentially(text);
  await input.press("Enter");
}
async function select(name: string) {
  await pickOption(tondo.page, "Select terminal", name);
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("nested splits preserve mounted terminals, focus, independent shells and a flat picker", async () => {
  test.setTimeout(90_000);
  const { page, app } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await command(pane("Terminal 1"), "export TONDO_PANE=one; printf 'FIRST_%s\\n' READY");
  await expect(pane("Terminal 1")).toContainText("FIRST_READY");
  await pane("Terminal 1")
    .locator(".xterm")
    .evaluate((element) => element.setAttribute("data-original", "yes"));
  await page.getByRole("button", { name: "Split vertically", exact: true }).click();
  await command(
    pane("Terminal 2"),
    "printf 'SECOND_%s\\n' READY; printf 'ISOLATED=%s\\n' \"${TONDO_PANE-unset}\"",
  );
  await expect(pane("Terminal 2")).toContainText("ISOLATED=unset");
  expect(await pane("Terminal 1").locator(".xterm").getAttribute("data-original")).toBe("yes");
  const first = (await pane("Terminal 1").boundingBox())!;
  const second = (await pane("Terminal 2").boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.y).toBe(first.y);
  await page.getByRole("button", { name: "Split horizontally", exact: true }).click();
  await command(pane("Terminal 3"), "printf 'THIRD_%s\\n' READY");
  await expect(pane("Terminal 3")).toContainText("THIRD_READY");
  expect(await pane("Terminal 1").locator(".xterm").getAttribute("data-original")).toBe("yes");
  const upper = (await pane("Terminal 2").boundingBox())!;
  const lower = (await pane("Terminal 3").boundingBox())!;
  expect(lower.x).toBe(upper.x);
  expect(lower.y).toBeGreaterThan(upper.y);
  await command(pane("Terminal 1"), "printf 'STILL=%s\\n' \"$TONDO_PANE\"");
  await expect(pane("Terminal 1")).toContainText("STILL=one");
  await expect(pane("Terminal 1")).toHaveAttribute("data-active", "true");
  const divider = page
    .getByRole("separator", { name: "Resize terminal panes", exact: true })
    .first();
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "55");
  const beforeDrag = (await pane("Terminal 1").boundingBox())!.width;
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 4);
  await page.mouse.down();
  await page.mouse.move(grip.x + 55, grip.y + grip.height / 4, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await pane("Terminal 1").boundingBox())!.width)
    .toBeGreaterThan(beforeDrag);
  expect(await pane("Terminal 1").locator(".xterm").getAttribute("data-original")).toBe("yes");
  await divider.press("Enter");
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await pane("Terminal 1").locator(".xterm-helper-textarea").focus();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({ path: `test-results/multiple-terminals-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(840, 700));
  await page.waitForFunction(() => window.innerWidth === 840);
  await expect(page.getByRole("button", { name: "Close terminal", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/multiple-terminals-narrow.png" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  await page.waitForFunction(() => window.innerWidth === 1440);
  await select("Terminal 2");
  await expect(pane("Terminal 2").locator(".xterm-helper-textarea")).toBeFocused();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await command(pane("Terminal 4"), "printf 'FOURTH_%s\\n' READY");
  await expect(page.locator("[data-terminal-view]")).toHaveCount(3);
  await expect(pane("Terminal 2")).toHaveCount(0);
  await expect(pane("Terminal 3")).toContainText("THIRD_READY");
  await select("Terminal 2");
  await expect(pane("Terminal 2")).toContainText("SECOND_READY");
  await expect(pane("Terminal 4")).toHaveCount(0);
  expect(await pickerOptions(page, "Select terminal")).toEqual([
    "Terminal 1",
    "Terminal 2",
    "Terminal 3",
    "Terminal 4",
  ]);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(pane("Terminal 2")).toHaveCount(0);
  await expect(page.locator("[data-terminal-view]")).toHaveCount(2);
  expect(await pane("Terminal 1").locator(".xterm").getAttribute("data-original")).toBe("yes");
  const originalThread = await threadRows(page).first().getAttribute("data-thread-id");
  await composer(page).press("ControlOrMeta+n");
  await waitForPi(page);
  await expect(page.locator("[data-terminal-view]")).toHaveCount(0);
  await page.locator(`button[data-thread-id="${originalThread}"]`).click();
  await expect(page.locator("[data-terminal-view]")).toHaveCount(2);
  await expect(pane("Terminal 1")).toContainText("STILL=one");
  await select("Terminal 4");
  await expect(pane("Terminal 4")).toContainText("FOURTH_READY");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Select terminal" })).toBeVisible();
  await select("Terminal 1");
  await expect(pane("Terminal 1")).toContainText("FIRST_READY");
  expect(errors).toEqual([]);
});

test("caps visible panes and retained shells without stopping hidden sessions", async () => {
  test.setTimeout(60_000);
  const { page } = tondo;
  for (let i = 2; i <= 4; i++) {
    await page.getByRole("button", { name: "Split vertically", exact: true }).click();
    await expect(pane(`Terminal ${i}`).locator(".xterm-helper-textarea")).toBeAttached();
  }
  await expect(page.locator("[data-terminal-view]")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Split vertically", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Split horizontally", exact: true }),
  ).toBeDisabled();
  for (let i = 5; i <= 8; i++) {
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await expect(pane(`Terminal ${i}`).locator(".xterm-helper-textarea")).toBeAttached();
  }
  await expect(page.getByRole("button", { name: "New terminal", exact: true })).toBeDisabled();
  expect(await pickerOptions(page, "Select terminal")).toHaveLength(8);
  await select("Terminal 5");
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("button", { name: "New terminal", exact: true })).toBeEnabled();
  await command(pane("Terminal 1"), "printf 'LIMIT_%s\\\\n' SURVIVOR");
  await expect(pane("Terminal 1")).toContainText("LIMIT_SURVIVOR");
});

test("hidden shells retain output without a rendered view and deleting one stops only its process group", async () => {
  test.setTimeout(60_000);
  const { page } = tondo;
  const ready = path.join(workDir, "ready");
  const gate = path.join(workDir, "gate");
  const done = path.join(workDir, "done");
  const program = path.join(workDir, "hidden.cjs");
  writeFileSync(
    program,
    `const fs=require('node:fs');const watcher=fs.watch(${JSON.stringify(workDir)},(_,name)=>{if(name!=='gate')return;watcher.close();process.stdout.write(('hidden-output-row\\r\\n').repeat(60000)+'HIDDEN_OUTPUT_COMPLETE\\r\\n',()=>fs.writeFileSync(${JSON.stringify(done)},'done'));});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));`,
  );
  await command(pane("Terminal 1"), `'${process.execPath}' '${program}'`);
  await expect.poll(() => existsSync(ready)).toBe(true);
  const child = Number(readFileSync(ready, "utf8"));
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await command(pane("Terminal 2"), "printf 'ACTIVE_%s\\n' READY");
  await expect(pane("Terminal 2")).toContainText("ACTIVE_READY");
  writeFileSync(gate, "go");
  await expect.poll(() => existsSync(done)).toBe(true);
  await expect(page.locator("[data-terminal-view]")).toHaveCount(1);
  await select("Terminal 1");
  await expect(pane("Terminal 1")).toContainText("HIDDEN_OUTPUT_COMPLETE");
  const pids = path.join(workDir, "pids");
  await command(pane("Terminal 1"), `echo $$ > '${pids}'; sleep 120 & echo $! >> '${pids}'; wait`);
  await expect
    .poll(() => (existsSync(pids) ? readFileSync(pids, "utf8").trim().split("\n").length : 0))
    .toBe(2);
  const owned = readFileSync(pids, "utf8").trim().split("\n").map(Number);
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect.poll(() => owned.map(alive)).toEqual([false, false]);
  await expect.poll(() => alive(child)).toBe(false);
  await command(pane("Terminal 2"), "printf 'SURVIVOR_%s\\n' READY");
  await expect(pane("Terminal 2")).toContainText("SURVIVOR_READY");
});
