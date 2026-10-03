// oxlint-disable eslint/no-await-in-loop -- each run owns the foreground window.
// Stage 10's output gate lives with perf, not in hardware-independent CI.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { bringToFront } from "./launch";
import { checkDisplay, median, perfRunDir } from "./perf";
import { addProject, launchWithPi, reply, waitForPi } from "./pi";

interface TerminalRun {
  cpuSlowdown: number;
  elapsedMs: number;
  bytes: number;
  longTasks: number[];
}
const results: TerminalRun[] = [];

test("50 MiB of terminal output", async () => {
  for (const cpuSlowdown of [1, 1, 1, 4]) results.push(await measure(cpuSlowdown));
  const dir = perfRunDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "terminal.json"), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    "# Terminal output",
    "",
    "Each run writes exactly 50 MiB through a real PTY, followed by a completion marker. The 4x run informs; it does not gate.",
    "",
    "| Run | CPU slowdown | Time (ms) | Tasks >=100 ms | Longest task (ms) |",
    "|---|---|---|---|---|",
    ...results.map(
      (run, i) =>
        `| ${i + 1} | ${run.cpuSlowdown}x | ${run.elapsedMs.toFixed(0)} | ${run.longTasks.filter((ms) => ms >= 100).length} | ${Math.max(0, ...run.longTasks)} |`,
    ),
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "terminal.md"), report);
  console.log(report);
  expect(
    median(
      results
        .filter((run) => run.cpuSlowdown === 1)
        .map((run) => run.longTasks.filter((ms) => ms >= 100).length),
    ),
  ).toBe(0);
});

async function measure(cpuSlowdown: number): Promise<TerminalRun> {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-terminal-perf-")));
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const script = path.join(workDir, "output.cjs");
  writeFileSync(
    script,
    `const {once}=require('node:events');(async()=>{const chunk=Buffer.from(('0123456789'.repeat(8)+'\\r\\n').repeat(256));let bytes=0;while(bytes<50*1024*1024){const part=chunk.subarray(0,Math.min(chunk.length,50*1024*1024-bytes));if(!process.stdout.write(part))await once(process.stdout,'drain');bytes+=part.length;}process.stdout.write('\\r\\nOUTPUT_COMPLETE_'+bytes+'\\r\\n');})();`,
  );
  const tondo = await launchWithPi({ workDir, script: { responses: [reply("Ready.")] } });
  try {
    const { page } = tondo;
    await bringToFront(tondo);
    await checkDisplay(page);
    await addProject(tondo, project);
    await waitForPi(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    const input = page.locator(".xterm-helper-textarea");
    const output = page.locator(".xterm-accessibility-tree");
    // The script writes CRLF itself; do not let the PTY add another CR per line.
    await input.pressSequentially("stty -onlcr; printf 'WARM_%s\\r\\n' READY");
    await input.press("Enter");
    await expect(output).toContainText("WARM_READY");
    await page.evaluate(() => {
      const durations: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
      Object.assign(window, { terminalLongTasks: durations, terminalObserver: observer });
    });
    const start = performance.now();
    await input.pressSequentially(`'${process.execPath}' '${script}'`);
    await input.press("Enter");
    await expect(output).toContainText("OUTPUT_COMPLETE_52428800", { timeout: 90_000 });
    const elapsedMs = performance.now() - start;
    const longTasks = await page.evaluate(() => {
      const state = window as typeof window & {
        terminalLongTasks: number[];
        terminalObserver: PerformanceObserver;
      };
      for (const entry of state.terminalObserver.takeRecords())
        state.terminalLongTasks.push(entry.duration);
      state.terminalObserver.disconnect();
      return state.terminalLongTasks;
    });
    const dir = perfRunDir();
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `terminal-${cpuSlowdown}x.png`) });
    return { cpuSlowdown, elapsedMs, bytes: 50 * 1024 * 1024, longTasks };
  } finally {
    await tondo.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}
