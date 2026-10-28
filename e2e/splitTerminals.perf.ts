// oxlint-disable eslint/no-await-in-loop -- each run owns the foreground window.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { bringToFront } from "./launch";
import { checkDisplay, measureMemory, median, perfRunDir, type Memory } from "./perf";
import { addProject, launchWithPi, reply, waitForPi } from "./pi";

interface Run {
  elapsedMs: number;
  longTasks: number[];
  before: Memory;
  fourIdle: Memory;
  after: Memory;
}

test("four split terminals render 50 MiB concurrently without 100 ms renderer tasks", async () => {
  const runs: Run[] = [];
  for (let i = 0; i < 3; i++) runs.push(await measure());
  const dir = perfRunDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "split-terminals.json"), `${JSON.stringify(runs, null, 2)}\n`);
  console.log(
    JSON.stringify(
      runs.map((run) => ({
        elapsedMs: run.elapsedMs,
        tasksOver100Ms: run.longTasks.filter((ms) => ms >= 100).length,
        longestTaskMs: Math.max(0, ...run.longTasks),
        additionalIdlePaneBytes: run.fourIdle.total - run.before.total,
        retainedOutputBytes: run.after.total - run.fourIdle.total,
        totalIncreaseBytes: run.after.total - run.before.total,
      })),
      null,
      2,
    ),
  );
  // Same long-task threshold as the original single-terminal gate. Memory is reported, not a new budget.
  expect(median(runs.map((run) => run.longTasks.filter((ms) => ms >= 100).length))).toBe(0);
});

async function measure(): Promise<Run> {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-split-perf-")));
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const script = path.join(workDir, "output.cjs");
  // All four processes wait for one local file event before producing output.
  writeFileSync(
    script,
    `const fs=require('node:fs');const {once}=require('node:events');const watcher=fs.watch(${JSON.stringify(workDir)},(_,name)=>{if(name!=='go')return;watcher.close();(async()=>{const chunk=Buffer.from(('0123456789'.repeat(8)+'\\r\\n').repeat(256));let bytes=0;while(bytes<13107200){const part=chunk.subarray(0,Math.min(chunk.length,13107200-bytes));if(!process.stdout.write(part))await once(process.stdout,'drain');bytes+=part.length;}process.stdout.write('\\r\\nSPLIT_OUTPUT_COMPLETE\\r\\n');})();});console.log('SPLIT_PROCESS_READY');`,
  );
  const tondo = await launchWithPi({
    workDir,
    exposeGc: true,
    script: { responses: [reply("Ready.")] },
  });
  try {
    const { page } = tondo;
    await bringToFront(tondo);
    await checkDisplay(page);
    await addProject(tondo, project);
    await waitForPi(page);
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator("[data-terminal-view]")).toHaveCount(1);
    const before = await measureMemory(tondo);
    await page.getByRole("button", { name: "Split vertically", exact: true }).click();
    await expect(page.locator("[data-terminal-view]")).toHaveCount(2);
    await page.getByRole("button", { name: "Split horizontally", exact: true }).click();
    await expect(page.locator("[data-terminal-view]")).toHaveCount(3);
    await page
      .getByRole("group", { name: "Terminal 1", exact: true })
      .locator(".xterm-helper-textarea")
      .focus();
    await page.getByRole("button", { name: "Split horizontally", exact: true }).click();
    await expect(page.locator("[data-terminal-view]")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Split vertically", exact: true }),
    ).toBeDisabled();
    const fourIdle = await measureMemory(tondo);
    for (let i = 1; i <= 4; i++) {
      const pane = page.getByRole("group", { name: `Terminal ${i}`, exact: true });
      const input = pane.locator(".xterm-helper-textarea");
      await input.focus();
      await input.pressSequentially(`stty -onlcr; '${process.execPath}' '${script}'`);
      await input.press("Enter");
      await expect(pane.locator(".xterm-accessibility-tree")).toContainText("SPLIT_PROCESS_READY");
    }
    await page.evaluate(() => {
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
      Object.assign(window, { splitPerf: { longTasks, observer } });
    });
    const start = performance.now();
    writeFileSync(path.join(workDir, "go"), "go");
    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        expect(
          page
            .getByRole("group", { name: `Terminal ${i}`, exact: true })
            .locator(".xterm-accessibility-tree"),
        ).toContainText("SPLIT_OUTPUT_COMPLETE", { timeout: 90_000 }),
      ),
    );
    const elapsedMs = performance.now() - start;
    const longTasks = await page.evaluate(() => {
      const { splitPerf } = window as typeof window & {
        splitPerf: { longTasks: number[]; observer: PerformanceObserver };
      };
      for (const entry of splitPerf.observer.takeRecords())
        splitPerf.longTasks.push(entry.duration);
      splitPerf.observer.disconnect();
      return splitPerf.longTasks;
    });
    const after = await measureMemory(tondo);
    return { elapsedMs, longTasks, before, fourIdle, after };
  } finally {
    await tondo.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}
