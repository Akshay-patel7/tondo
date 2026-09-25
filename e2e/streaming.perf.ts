// oxlint-disable eslint/no-await-in-loop -- runs take turns, each one measuring a single app in front.
// The Stage 1 perf scenarios from docs/plan.md, "Performance budgets". Each
// run launches Tondo in a visible window kept on top, because Electron
// throttles frames in windows you can't see. `pnpm perf` runs them all and
// writes results.json, report.md and the screenshots to .dev/perf/<time>/.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { READY_MARK } from "../src/shared/ready";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  fixtureDuration,
  measureFrameInterval,
  measureMemory,
  median,
  percentile,
  recordPlayback,
  recordSwitch,
  type Memory,
  type PlaybackRecord,
} from "./perf";
import { FOLLOW_THRESHOLD_PX, LAST_TRANSCRIPT_ROW, play, waitForTranscript } from "./timeline";

const RUNS = 3;
const STREAMS = ["stream-1000", "stream-200"] as const;
type StreamFixture = (typeof STREAMS)[number];
const TOKENS_PER_SECOND: Record<StreamFixture, string> = {
  "stream-1000": "1,000",
  "stream-200": "200",
};
/** Switch threads once the reply on screen is this long, about a quarter of it. */
const SWITCH_AT_CHARS = 20_000;
const WORDS = ["the ", "quick ", "brown ", "fox ", "jumps ", "over ", "a ", "lazy ", "dog "];

const BUDGET = {
  frameP95: 16.7,
  frameP99: 33,
  longTaskMs: 100,
  inputP95: 32,
  switchMs: 100,
  coldStartMs: 1000,
};

interface StreamRun {
  frameInterval: number;
  playedMs: number;
  frames: number;
  frameP95: number;
  frameP99: number;
  frameMax: number;
  /** Tasks of BUDGET.longTaskMs or more. */
  longTasks: number;
  longestTask: number;
  keys: number;
  /** 0 when fewer than 5% of keys took 16 ms or more. */
  inputP95: number;
  slowFrames: PlaybackRecord["slowFrames"];
  memoryBefore: Memory;
  memoryAfter: Memory;
}

interface ColdStart {
  /** From launch to the first painted frame, when the composer takes input. */
  interactiveMs: number;
  /** From launch to the transcript's last row on screen. An upper bound. */
  transcriptMs: number;
}

const results = {
  machine: `${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 2 ** 30)} GB, macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()}`,
  coldStarts: [] as ColdStart[],
  streams: { "stream-1000": [] as StreamRun[], "stream-200": [] as StreamRun[] },
  switches: [] as number[],
  slowdown: {
    streams: {} as Partial<Record<StreamFixture, StreamRun>>,
    switchMs: undefined as number | undefined,
  },
  screenshots: [] as string[],
};

const reportDir = path.resolve(
  __dirname,
  "..",
  ".dev",
  "perf",
  new Date().toISOString().replaceAll(":", "-").replace(/\..*/, ""),
);

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await mkdir(reportDir, { recursive: true });
  const report = formatReport();
  await writeFile(path.join(reportDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(reportDir, "report.md"), report);
  console.log(`\n${report}\nWritten to ${reportDir}`);
});

test("cold start", async () => {
  for (let run = 0; run < RUNS; run++) results.coldStarts.push(await measureColdStart());
});

for (const fixture of STREAMS) {
  test(`streaming at ${TOKENS_PER_SECOND[fixture]} tokens per second`, async () => {
    test.setTimeout(RUNS * ((await fixtureDuration(fixture)) + 60_000));
    for (let run = 0; run < RUNS; run++)
      results.streams[fixture].push(await measureStream(fixture));
  });
}

test("switching to a thread whose pi is running", async () => {
  test.setTimeout(RUNS * 60_000);
  for (let run = 0; run < RUNS; run++) results.switches.push(await measureSwitch());
});

test("at 4x CPU slowdown, for information", async () => {
  test.setTimeout(10 * 60_000);
  for (const fixture of STREAMS)
    results.slowdown.streams[fixture] = await measureStream(fixture, 4);
  results.slowdown.switchMs = await measureSwitch(4);
});

test("screenshots mid-stream", async () => {
  await mkdir(reportDir, { recursive: true });
  await withTondo(async ({ page }) => {
    await play(page, "stream-1000");
    for (const [index, chars] of [20_000, 50_000].entries()) {
      await waitForReply(page, chars);
      const file = path.join(reportDir, `mid-stream-${index + 1}.png`);
      await page.screenshot({ path: file });
      results.screenshots.push(file);
    }
  });
});

test("budgets", () => {
  for (const fixture of STREAMS) {
    const runs = results.streams[fixture];
    const rate = `${TOKENS_PER_SECOND[fixture]} tokens per second`;
    expect
      .soft(median(runs.map((run) => run.frameP95)), `frame time p95 at ${rate}`)
      .toBeLessThanOrEqual(BUDGET.frameP95);
    expect
      .soft(median(runs.map((run) => run.frameP99)), `frame time p99 at ${rate}`)
      .toBeLessThanOrEqual(BUDGET.frameP99);
    expect.soft(median(runs.map((run) => run.longTasks)), `long tasks at ${rate}`).toBe(0);
    expect
      .soft(median(runs.map((run) => run.inputP95)), `input to paint p95 at ${rate}`)
      .toBeLessThanOrEqual(BUDGET.inputP95);
  }
  expect
    .soft(median(results.switches), "switch to a running thread")
    .toBeLessThanOrEqual(BUDGET.switchMs);
  expect
    .soft(median(results.coldStarts.map((run) => run.interactiveMs)), "cold start")
    .toBeLessThanOrEqual(BUDGET.coldStartMs);
});

/**
 * Launches Tondo in front with `gc()` exposed for measureMemory, waits for
 * the transcript, runs `body` and quits.
 */
async function withTondo<T>(body: (tondo: Tondo) => Promise<T>): Promise<T> {
  const tondo = await launchTondo({ exposeGc: true });
  try {
    await bringToFront(tondo);
    await waitForTranscript(tondo.page);
    return await body(tondo);
  } finally {
    await tondo.close();
  }
}

async function slowDownCpu(page: Page, rate: number): Promise<void> {
  if (rate === 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

async function waitForReply(page: Page, chars: number): Promise<void> {
  await page.waitForFunction(
    (length) => (document.querySelector("[data-streaming]")?.textContent?.length ?? 0) >= length,
    chars,
    { polling: 100, timeout: 60_000 },
  );
}

async function measureColdStart(): Promise<ColdStart> {
  const tondo = await launchTondo();
  try {
    const { page, launchedAt } = tondo;
    const readyAt = await page.evaluate(
      (mark) => performance.timeOrigin + performance.getEntriesByName(mark)[0]!.startTime,
      READY_MARK,
    );
    await bringToFront(tondo);
    // The check starts after the window is ready, so it can only run late.
    const transcriptAt = await page.evaluate(
      (row) =>
        new Promise<number>((resolve) => {
          const onFrame = () => {
            const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
            const last = document.querySelector(`[data-index="${row}"]`);
            if (scroller && last) {
              const view = scroller.getBoundingClientRect();
              const rect = last.getBoundingClientRect();
              if (rect.bottom > view.top && rect.top < view.bottom) {
                resolve(performance.timeOrigin + performance.now());
                return;
              }
            }
            requestAnimationFrame(onFrame);
          };
          onFrame();
        }),
      LAST_TRANSCRIPT_ROW,
    );
    return { interactiveMs: readyAt - launchedAt, transcriptMs: transcriptAt - launchedAt };
  } finally {
    await tondo.close();
  }
}

/** Plays a fixture while typing into the composer at 10 keys per second. */
async function measureStream(fixture: StreamFixture, cpuSlowdown = 1): Promise<StreamRun> {
  const duration = await fixtureDuration(fixture);
  return withTondo(async (tondo) => {
    const { page } = tondo;
    const frameInterval = await measureFrameInterval(page);
    const memoryBefore = await measureMemory(tondo);
    await slowDownCpu(page, cpuSlowdown);
    const finished = await recordPlayback(page);
    await play(page, fixture);
    await page.getByLabel("Message").focus();
    const player = page.getByTestId("player");
    for (let word = 0; (await player.getAttribute("data-status")) === "playing"; word++) {
      await page.keyboard.type(WORDS[word % WORDS.length]!, { delay: 100 });
    }
    const record = await finished();
    const memoryAfter = await measureMemory(tondo);

    expect(record.playedMs, "the player played the whole fixture").toBeGreaterThanOrEqual(duration);
    expect(record.keys, "the keys reached the page").toBeGreaterThan(0);
    expect(record.timedKeys, "Event Timing saw every key").toBeGreaterThanOrEqual(record.keys);
    const frameTimes = record.frames.slice(1).map((time, index) => time - record.frames[index]!);
    // Keys Event Timing didn't report took under 16 ms. They count as 0.
    const unreported = Math.max(0, record.keys - record.slowKeys.length);
    return {
      frameInterval,
      playedMs: record.playedMs,
      frames: record.frames.length,
      frameP95: percentile(frameTimes, 95),
      frameP99: percentile(frameTimes, 99),
      frameMax: Math.max(...frameTimes),
      longTasks: record.longTasks.filter((task) => task >= BUDGET.longTaskMs).length,
      longestTask: Math.max(0, ...record.longTasks),
      keys: record.keys,
      inputP95: percentile([...record.slowKeys, ...Array<number>(unreported).fill(0)], 95),
      slowFrames: record.slowFrames,
      memoryBefore,
      memoryAfter,
    };
  });
}

/** Reopens the thread while pi streams into it, the stand-in for switching to it. */
async function measureSwitch(cpuSlowdown = 1): Promise<number> {
  return withTondo(async ({ page }) => {
    await slowDownCpu(page, cpuSlowdown);
    await play(page, "stream-1000");
    await waitForReply(page, SWITCH_AT_CHARS);
    const switched = await recordSwitch(page, FOLLOW_THRESHOLD_PX);
    await page.getByRole("button", { name: "Reopen" }).click();
    return switched();
  });
}

// Frame-sized values keep a decimal, so a 16.7 ms frame doesn't print as 17 ms.
const time = (ms: number) => `${ms < 20 ? ms.toFixed(1) : Math.round(ms)} ms`;
const input = (ms: number) => (ms === 0 ? "under 16 ms" : time(ms));
// The Long Tasks API reports only tasks over 50 ms.
const task = (ms: number) => (ms === 0 ? "none over 50 ms" : time(ms));
const mib = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MiB`;
/** The median, then every run. */
const runs = (values: number[], format: (value: number) => string) =>
  values.length === 0 ? "not run" : `${format(median(values))} (${values.map(format).join(", ")})`;

function formatReport(): string {
  const perStream = (
    label: string,
    budget: string,
    pick: (run: StreamRun) => number,
    format = time,
  ) =>
    `| ${label} | ${budget} | ${STREAMS.map((fixture) => runs(results.streams[fixture].map(pick), format)).join(" | ")} |`;
  const slow = (pick: (run: StreamRun) => number, format = time) =>
    STREAMS.map((fixture) => {
      const run = results.slowdown.streams[fixture];
      return run ? format(pick(run)) : "not run";
    }).join(" | ");
  const intervals = STREAMS.flatMap((fixture) =>
    results.streams[fixture].map((run) => run.frameInterval),
  );

  return [
    `# Stage 1 perf report`,
    ``,
    `Machine: ${results.machine}. Frame interval ${intervals.length > 0 ? time(median(intervals)) : "not measured"}.`,
    `Medians of ${RUNS} runs, each run in parentheses.`,
    ``,
    `| Metric | Budget | 1,000 tok/s | 200 tok/s |`,
    `|---|---|---|---|`,
    perStream("Frame time p95", "16.7 ms or less", (run) => run.frameP95),
    perStream("Frame time p99", "33 ms or less", (run) => run.frameP99),
    perStream("Longest frame", "", (run) => run.frameMax),
    perStream("Long tasks of 100 ms or more", "none", (run) => run.longTasks, String),
    perStream("Longest task", "", (run) => run.longestTask, task),
    perStream("Input to paint p95", "32 ms or less", (run) => run.inputP95, input),
    perStream("Keys typed", "", (run) => run.keys, String),
    perStream("Memory, all processes, before", "baseline", (run) => run.memoryBefore.total, mib),
    perStream("Memory, all processes, after", "baseline", (run) => run.memoryAfter.total, mib),
    perStream("Memory, renderer, before", "baseline", (run) => run.memoryBefore.renderer, mib),
    perStream("Memory, renderer, after", "baseline", (run) => run.memoryAfter.renderer, mib),
    ``,
    `| Metric | Budget | Result |`,
    `|---|---|---|`,
    `| Switch to a thread whose pi is running | 100 ms or less | ${runs(results.switches, time)} |`,
    `| Cold start, window interactive | 1 s or less | ${runs(
      results.coldStarts.map((run) => run.interactiveMs),
      time,
    )} |`,
    `| Cold start, transcript on screen (upper bound) | | ${runs(
      results.coldStarts.map((run) => run.transcriptMs),
      time,
    )} |`,
    ``,
    `At 4x CPU slowdown, one run each, for information:`,
    ``,
    `| Metric | 1,000 tok/s | 200 tok/s |`,
    `|---|---|---|`,
    `| Frame time p95 | ${slow((run) => run.frameP95)} |`,
    `| Frame time p99 | ${slow((run) => run.frameP99)} |`,
    `| Long tasks of 100 ms or more | ${slow((run) => run.longTasks, String)} |`,
    `| Longest task | ${slow((run) => run.longestTask, task)} |`,
    `| Input to paint p95 | ${slow((run) => run.inputP95, input)} |`,
    ``,
    `Switch to a running thread at 4x: ${results.slowdown.switchMs === undefined ? "not run" : time(results.slowdown.switchMs)}.`,
    ``,
  ].join("\n");
}
