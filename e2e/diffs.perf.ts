// oxlint-disable eslint/no-await-in-loop -- runs take turns, each one measuring a single app in front.
// Stage 6's diff budget from docs/plan.md: a 5,000-line diff renders with no
// long task of 100 ms or more. pi's edit changes every line of a file, and
// each run opens the edit's card, which loads @pierre/diffs and starts its
// worker pool, then records the page until the diff is done. Syntax colors
// stop at 2,500 lines a side (src/renderer/tools/code.tsx), so a 2,500-line
// file makes the largest diff that gets them: 2,500 lines removed and 2,500
// added. A 5,000-line file makes a 10,000-line diff that shows uncolored.
// `pnpm perf` runs it with the other perf files and writes diffs.json and
// diffs.md to the same folder.
import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bringToFront } from "./launch";
import { checkDisplay, measureMemory, median, perfRunDir, type Memory } from "./perf";
import { addProject, launchWithPi, reply, send, toolCalls, waitForPi } from "./pi";

const RUNS = 3;
const BUDGET = { longTaskMs: 100 };
const CALL_ID = "call_edit";

interface Scenario {
  label: string;
  /** Lines in the file pi edits. Every one of them changes. */
  fileLines: number;
  /** Whether the diff gets syntax colors. */
  colored: boolean;
}

const SCENARIOS: Scenario[] = [
  { label: "5,000-line diff, colored", fileLines: 2500, colored: true },
  { label: "10,000-line diff, uncolored", fileLines: 5000, colored: false },
];

interface DiffRun {
  /** From the click that opens the card until its diff shows rows. */
  rowsMs: number;
  /** Until the first frame that shows the diff colored. Null for an uncolored diff. */
  coloredMs: number | null;
  /** Tasks of BUDGET.longTaskMs or more. */
  longTasks: number;
  /** The Long Tasks API reports tasks over 50 ms only. */
  longestTask: number;
  /** Animation frames over 50 ms, longest first. */
  slowFrames: number[];
  memoryBefore: Memory;
  memoryAfter: Memory;
}

interface ScenarioResult extends Scenario {
  runs: DiffRun[];
  slowdown: DiffRun | undefined;
}

const results: ScenarioResult[] = SCENARIOS.map(({ label, fileLines, colored }) => ({
  label,
  fileLines,
  colored,
  runs: [],
  slowdown: undefined,
}));

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const dir = perfRunDir();
  await mkdir(dir, { recursive: true });
  const report = formatReport();
  await writeFile(path.join(dir, "diffs.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(dir, "diffs.md"), report);
  console.log(`\n${report}\nWritten to ${dir}`);
});

for (const result of results) {
  test(`opening a ${result.label}`, async () => {
    test.setTimeout(RUNS * 90_000);
    for (let run = 0; run < RUNS; run++) result.runs.push(await measureDiff(result));
  });

  test(`opening a ${result.label}, at 4x CPU slowdown, for information`, async () => {
    test.setTimeout(120_000);
    result.slowdown = await measureDiff(result, 4);
  });
}

test("budgets", () => {
  for (const { label, runs } of results) {
    expect.soft(median(runs.map((run) => run.longTasks)), `long tasks opening a ${label}`).toBe(0);
  }
});

/** The file before and after the edit: every line's arithmetic changes. */
function fileTexts(lines: number): { before: string; after: string } {
  const steps = Array.from(
    { length: lines },
    (_, index) =>
      `export function step${index}(value: number): number { return value + ${index}; }`,
  );
  const changed = steps.map((line, index) => line.replace(`+ ${index};`, `* ${index + 1};`));
  return { before: `${steps.join("\n")}\n`, after: `${changed.join("\n")}\n` };
}

/**
 * Has the faux pi edit the whole file, then opens the edit's card and
 * records the page until the diff is done.
 */
async function measureDiff({ fileLines, colored }: Scenario, cpuSlowdown = 1): Promise<DiffRun> {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-diffs-")));
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const { before, after } = fileTexts(fileLines);
  writeFileSync(path.join(project, "steps.ts"), before);
  const edit = { path: "steps.ts", edits: [{ oldText: before, newText: after }] };
  const tondo = await launchWithPi({
    workDir,
    exposeGc: true,
    script: {
      responses: [toolCalls({ id: CALL_ID, name: "edit", arguments: edit }), reply("Done.")],
    },
  });
  try {
    const { page } = tondo;
    await bringToFront(tondo);
    await checkDisplay(page);
    await addProject(tondo, project);
    await waitForPi(page);
    await send(page, "Multiply every step.");
    const card = page.locator(`[data-tool-call="${CALL_ID}"]`);
    await expect(card).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(page.getByText("Done.")).toBeVisible();
    await expect(card.getByRole("button").first()).toHaveText(
      `edit steps.ts +${fileLines} −${fileLines}`,
    );

    const memoryBefore = await measureMemory(tondo);
    await slowDownCpu(page, cpuSlowdown);
    const finished = await recordOpening(page, colored);
    await card.getByRole("button").first().click();
    const record = await finished();
    const memoryAfter = await measureMemory(tondo);
    expect(record.rows, "the diff is virtualized").toBeLessThan(fileLines);
    expect(record.colored, "the diff got syntax colors").toBe(colored);
    return {
      rowsMs: record.rowsMs,
      coloredMs: record.coloredMs,
      longTasks: record.longTasks.filter((duration) => duration >= BUDGET.longTaskMs).length,
      longestTask: Math.max(0, ...record.longTasks),
      slowFrames: record.slowFrames,
      memoryBefore,
      memoryAfter,
    };
  } finally {
    await tondo.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function slowDownCpu(page: Page, rate: number): Promise<void> {
  if (rate === 1) return;
  // The session stays open, since the rate lasts only as long as it does.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

interface OpeningRecord {
  rowsMs: number;
  coloredMs: number | null;
  /** Whether the diff showed a colored token by the end. */
  colored: boolean;
  /** The diff's rows on the page at the end. */
  rows: number;
  longTasks: number[];
  slowFrames: number[];
}

/**
 * Starts recording in the page before the click that opens the card. It
 * records from the click until the diff is done: once it shows a colored
 * token, or once it shows rows if it gets no colors. It stops a few frames
 * later, so the work of the frames before counts.
 */
async function recordOpening(page: Page, colored: boolean): Promise<() => Promise<OpeningRecord>> {
  const handle = await page.evaluateHandle(
    ({ id, waitForColors }) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- the page gets this function as source, so its helpers must live inside it.
      const observe = (type: string) => {
        const entries: PerformanceEntry[] = [];
        const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        observer.observe({ type });
        return () => {
          entries.push(...observer.takeRecords());
          observer.disconnect();
          return entries;
        };
      };
      const stopLongTasks = observe("longtask");
      const stopLongFrames = observe("long-animation-frame");
      const diff = () =>
        document.querySelector(`[data-tool-call="${id}"] diffs-container`)?.shadowRoot;
      let clickedAt: number | undefined;
      addEventListener("click", (event) => (clickedAt = event.timeStamp), {
        capture: true,
        once: true,
      });
      const done = new Promise<OpeningRecord>((resolve) => {
        let rowsMs: number | undefined;
        let coloredMs: number | undefined;
        // Frames to wait once the diff is done, so the entries for the frames
        // before have been reported.
        let settleFrames = 3;
        const onFrame = (time: number) => {
          if (clickedAt !== undefined) {
            const root = diff();
            if (root?.querySelector("[data-line-type]")) rowsMs ??= time - clickedAt;
            if (root?.querySelector('span[style*="--diffs-token"]')) coloredMs ??= time - clickedAt;
            const finished = waitForColors ? coloredMs !== undefined : rowsMs !== undefined;
            if (finished && --settleFrames === 0) {
              const start = clickedAt;
              const within = (entry: PerformanceEntry) => entry.startTime >= start;
              resolve({
                rowsMs: rowsMs!,
                coloredMs: coloredMs ?? null,
                colored: coloredMs !== undefined,
                rows: root?.querySelectorAll("[data-line-type]").length ?? 0,
                longTasks: stopLongTasks()
                  .filter(within)
                  .map((entry) => entry.duration),
                slowFrames: stopLongFrames()
                  .filter(within)
                  .map((entry) => entry.duration)
                  .toSorted((a, b) => b - a),
              });
              return;
            }
          }
          requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      });
      return { done };
    },
    { id: CALL_ID, waitForColors: colored },
  );
  return () => handle.evaluate(({ done }) => done);
}

const time = (ms: number) => `${ms < 20 ? ms.toFixed(1) : Math.round(ms)} ms`;
const task = (ms: number) => (ms === 0 ? "none over 50 ms" : time(ms));
const mib = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MiB`;
const runs = (values: number[], format: (value: number) => string) =>
  values.length === 0 ? "not run" : `${format(median(values))} (${values.map(format).join(", ")})`;

/** A report row for one scenario: the median of the runs, each run, and the slowed-down run. */
function row(
  result: ScenarioResult,
  label: string,
  budget: string,
  pick: (run: DiffRun) => number | null,
  format = time,
): string {
  const values = result.runs.map(pick).filter((value) => value !== null);
  const slowValue = result.slowdown ? pick(result.slowdown) : null;
  const slow = slowValue === null ? "not run" : format(slowValue);
  const measured = values.length === 0 ? "none" : runs(values, format);
  return `| ${label} | ${budget} | ${measured} | ${slow} |`;
}

function formatReport(): string {
  return [
    `# Diff perf report`,
    ``,
    `pi's edit changes every line of a file, and each run opens its card. Syntax colors stop at 2,500 lines a side.`,
    `Medians of ${RUNS} runs, each run in parentheses, and one run at 4x CPU slowdown for information. Memory counts Tondo's processes, not pi's, and the pool's workers run in the renderer.`,
    ...results.flatMap((result) => [
      ``,
      `## ${result.label[0]!.toUpperCase()}${result.label.slice(1)}: every line of a ${result.fileLines.toLocaleString("en-US")}-line file`,
      ``,
      `| Metric | Budget | Result | 4x slowdown |`,
      `|---|---|---|---|`,
      row(result, "Long tasks of 100 ms or more", "none", (run) => run.longTasks, String),
      row(result, "Longest task", "", (run) => run.longestTask, task),
      row(result, "Longest animation frame", "", (run) => run.slowFrames[0] ?? 0, task),
      row(result, "Click to the diff's rows", "", (run) => run.rowsMs),
      row(result, "Click to the diff colored", "", (run) => run.coloredMs),
      row(result, "Memory, all processes, before", "", (run) => run.memoryBefore.total, mib),
      row(result, "Memory, all processes, after", "", (run) => run.memoryAfter.total, mib),
      row(result, "Memory, renderer, before", "", (run) => run.memoryBefore.renderer, mib),
      row(result, "Memory, renderer, after", "", (run) => run.memoryAfter.renderer, mib),
    ]),
    ``,
  ].join("\n");
}
