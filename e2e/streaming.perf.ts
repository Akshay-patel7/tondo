// oxlint-disable eslint/no-await-in-loop -- runs take turns, each one measuring a single app in front.
// The perf scenarios from docs/plan.md, "Performance budgets", on the live
// pipeline: the faux pi streams a 20,000-token reply into a thread that holds
// the recorded 1,000-message transcript, alone or with 9 other threads
// streaming too. Each run launches Tondo in a visible window kept on top,
// because Electron throttles frames in windows you can't see. `pnpm perf`
// runs them all and writes results.json, report.md and the screenshots to
// .dev/perf/<time>/.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { expect, test, type Page } from "@playwright/test";
import { READY_MARK } from "../src/shared/ready";
import {
  checkDisplay,
  measureFrameInterval,
  measureMemory,
  median,
  percentile,
  perfRunDir,
  recordStream,
  switchThread,
  type Memory,
  type StreamRecord,
} from "./perf";
import { addProject, composer, longReply, send, THREAD_ROW, threads, waitForIdle } from "./pi";
import {
  FOLLOW_THRESHOLD_PX,
  launchOnTranscript,
  newTranscriptThread,
  openTranscript,
  waitForReply,
  type TranscriptTondo,
} from "./timeline";

const RUNS = 3;
/** Tokens per second. */
const RATES = [1000, 200] as const;
type Rate = (typeof RATES)[number];
const PROMPT = "Walk me through the parser rewrite, with code.";
/** The reply `pnpm fixtures` recorded from the faux model, markdown with code. */
const REPLY = longReply();
/** Threads streaming at once in the busy runs, the one on screen included. */
const BUSY_THREADS = 10;
/**
 * Follow-ups queued in each thread the busy runs leave streaming, so those
 * threads stream the reply 4 times over and outlast the thread on screen.
 */
const FOLLOW_UPS = 3;
/** One reply for each model call pi makes: the prompt, then each follow-up. */
const REPLIES = Array<AssistantMessage>(1 + FOLLOW_UPS).fill(REPLY);
/** Leave the thread once the reply on screen is this long, about a quarter of it. */
const SWITCH_AT_CHARS = 20_000;
const WORDS = ["the ", "quick ", "brown ", "fox ", "jumps ", "over ", "a ", "lazy ", "dog "];

const BUDGET = {
  frameP95: 16.7,
  frameP99: 33,
  longTaskMs: 100,
  inputP95: 32,
  switchMs: 100,
  coldStartMs: 1000,
  /** Fixed single-thread totals from docs/plan.md, compared before rounding. */
  memoryBeforeMiB: 279.4,
  memoryAfterMiB: { 1000: 510.4, 200: 522.5 },
  /** docs/plan.md holds the time behind the end to the thread-switch budget. */
  lagMs: 100,
};

interface StreamRun {
  frameInterval: number;
  streamedMs: number;
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
  slowFrames: StreamRecord["slowFrames"];
  /** The longest the view stayed more than FOLLOW_THRESHOLD_PX short of the end. */
  longestLag: number;
  memoryBefore: Memory;
  memoryAfter: Memory;
}

interface ColdStart {
  /** From launch to the first painted frame, when the window takes input. */
  interactiveMs: number;
  /** From the click on Add project to the transcript's last row on screen. It includes starting pi. */
  openMs: number;
}

const results = {
  machine: `${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 2 ** 30)} GB, macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()}`,
  coldStarts: [] as ColdStart[],
  streams: { 1000: [] as StreamRun[], 200: [] as StreamRun[] },
  /** At 1,000 tokens per second, with BUSY_THREADS threads streaming. */
  busy: [] as StreamRun[],
  switches: [] as number[],
  slowdown: {
    streams: {} as Partial<Record<Rate, StreamRun>>,
    switchMs: undefined as number | undefined,
  },
  screenshots: [] as string[],
};

const reportDir = perfRunDir();

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await mkdir(reportDir, { recursive: true });
  const report = formatReport();
  await writeFile(path.join(reportDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(reportDir, "report.md"), report);
  console.log(`\n${report}\nWritten to ${reportDir}`);
});

test("cold start", async () => {
  test.setTimeout(RUNS * 60_000);
  for (let run = 0; run < RUNS; run++) results.coldStarts.push(await measureColdStart());
});

for (const rate of RATES) {
  test(`streaming at ${rate.toLocaleString("en-US")} tokens per second`, async () => {
    test.setTimeout(RUNS * (leastStreamMs(rate) + 60_000));
    for (let run = 0; run < RUNS; run++) results.streams[rate].push(await measureStream(rate));
  });
}

test(`streaming with ${BUSY_THREADS} threads streaming at once`, async () => {
  test.setTimeout(RUNS * (leastStreamMs(1000) + 120_000));
  for (let run = 0; run < RUNS; run++) results.busy.push(await measureBusyStream());
});

test("switching to a thread whose pi is running", async () => {
  test.setTimeout(RUNS * 60_000);
  for (let run = 0; run < RUNS; run++) results.switches.push(await measureSwitch());
});

test("at 4x CPU slowdown, for information", async () => {
  test.setTimeout(10 * 60_000);
  for (const rate of RATES) results.slowdown.streams[rate] = await measureStream(rate, 4);
  results.slowdown.switchMs = await measureSwitch(4);
});

test("screenshots mid-stream", async () => {
  await mkdir(reportDir, { recursive: true });
  await withTondo(1000, async (tondo) => {
    const { page } = tondo;
    await openTranscript(tondo);
    await send(page, PROMPT);
    for (const [index, chars] of [20_000, 50_000].entries()) {
      await waitForReply(page, chars);
      const file = path.join(reportDir, `mid-stream-${index + 1}.png`);
      await page.screenshot({ path: file });
      results.screenshots.push(file);
    }
  });
});

test("budgets", () => {
  const scenarios: [string, StreamRun[]][] = [
    ...RATES.map((rate): [string, StreamRun[]] => [
      `at ${rate.toLocaleString("en-US")} tokens per second`,
      results.streams[rate],
    ]),
    [`with ${BUSY_THREADS} threads streaming`, results.busy],
  ];
  for (const [at, runs] of scenarios) {
    expect
      .soft(median(runs.map((run) => run.frameP95)), `frame time p95 ${at}`)
      .toBeLessThanOrEqual(BUDGET.frameP95);
    expect
      .soft(median(runs.map((run) => run.frameP99)), `frame time p99 ${at}`)
      .toBeLessThanOrEqual(BUDGET.frameP99);
    expect.soft(median(runs.map((run) => run.longTasks)), `long tasks ${at}`).toBe(0);
    expect
      .soft(median(runs.map((run) => run.inputP95)), `input to paint p95 ${at}`)
      .toBeLessThanOrEqual(BUDGET.inputP95);
    expect
      .soft(median(runs.map((run) => run.longestLag)), `time behind the end ${at}`)
      .toBeLessThanOrEqual(BUDGET.lagMs);
  }
  for (const rate of RATES) {
    const runs = results.streams[rate];
    expect
      .soft(
        median(runs.map((run) => run.memoryBefore.total)) / 2 ** 20,
        `total memory before streaming at ${rate} tokens per second (MiB)`,
      )
      .toBeLessThanOrEqual(BUDGET.memoryBeforeMiB);
    expect
      .soft(
        median(runs.map((run) => run.memoryAfter.total)) / 2 ** 20,
        `total memory after streaming at ${rate} tokens per second (MiB)`,
      )
      .toBeLessThanOrEqual(BUDGET.memoryAfterMiB[rate]);
  }
  expect
    .soft(median(results.switches), "switch to a running thread")
    .toBeLessThanOrEqual(BUDGET.switchMs);
  expect
    .soft(median(results.coldStarts.map((run) => run.interactiveMs)), "cold start")
    .toBeLessThanOrEqual(BUDGET.coldStartMs);
});

/**
 * The least time the faux model takes to stream the reply at `rate` tokens
 * per second. Before each chunk of text it waits the chunk's length over 4,
 * rounded up, over `rate` seconds.
 */
function leastStreamMs(rate: Rate): number {
  const chars = REPLY.content.reduce(
    (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
    0,
  );
  return (chars / 4 / rate) * 1000;
}

/**
 * Launches Tondo in front on the transcript, with `gc()` exposed for
 * measureMemory and the faux pi set to stream the reply at `rate` each time
 * it answers. Runs `body` and quits.
 */
async function withTondo<T>(rate: Rate, body: (tondo: TranscriptTondo) => Promise<T>): Promise<T> {
  const tondo = await launchOnTranscript({
    script: { tokensPerSecond: rate, responses: REPLIES },
    exposeGc: true,
  });
  try {
    await checkDisplay(tondo.page);
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

/** Launches Tondo, then opens the transcript's project, as you would after launch. */
async function measureColdStart(): Promise<ColdStart> {
  const tondo = await launchOnTranscript({ script: { responses: [] } });
  try {
    const { page, launchedAt } = tondo;
    await checkDisplay(page);
    const readyAt = await page.evaluate(
      (mark) => performance.timeOrigin + performance.getEntriesByName(mark)[0]!.startTime,
      READY_MARK,
    );
    const opened = await page.evaluateHandle((row) => {
      const done = new Promise<number>((resolve) => {
        const onClick = (click: MouseEvent) => {
          let onScreen = false;
          const onFrame = (time: number) => {
            // The state checked in the previous frame painted before this one began.
            if (onScreen) {
              resolve(time - click.timeStamp);
              return;
            }
            const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
            const last = document.querySelector(`[data-index="${row}"]`);
            if (scroller && last) {
              const view = scroller.getBoundingClientRect();
              const rect = last.getBoundingClientRect();
              onScreen = rect.bottom > view.top && rect.top < view.bottom;
            }
            requestAnimationFrame(onFrame);
          };
          requestAnimationFrame(onFrame);
        };
        addEventListener("click", onClick, { capture: true, once: true });
      });
      return { done };
    }, tondo.messages - 1);
    await addProject(tondo, tondo.project);
    const openMs = await opened.evaluate(({ done }) => done);
    return { interactiveMs: readyAt - launchedAt, openMs };
  } finally {
    await tondo.close();
  }
}

/** Streams the reply into the transcript's thread, the only thread. */
function measureStream(rate: Rate, cpuSlowdown = 1): Promise<StreamRun> {
  return withTondo(rate, async (tondo) => {
    await openTranscript(tondo);
    return measureReply(tondo, rate, cpuSlowdown);
  });
}

/**
 * Leaves BUSY_THREADS - 1 threads streaming the reply, each with FOLLOW_UPS
 * follow-ups queued, then streams it into a new thread on screen.
 */
function measureBusyStream(): Promise<StreamRun> {
  return withTondo(1000, async (tondo) => {
    const { page } = tondo;
    await openTranscript(tondo);
    for (let thread = 1; thread < BUSY_THREADS; thread++) {
      await send(page, PROMPT);
      await expect(page.locator("[data-streaming]")).toBeAttached();
      for (let followUp = 0; followUp < FOLLOW_UPS; followUp++) {
        await send(page, "Go on.", "Alt+Enter");
      }
      await newTranscriptThread(tondo);
    }
    const run = await measureReply(tondo, 1000);
    // The other threads still stream, so they streamed the whole time.
    await expect(threads(page).getByRole("img", { name: "Working" })).toHaveCount(BUSY_THREADS - 1);
    return run;
  });
}

/**
 * Sends the prompt in the thread on screen, and types into the composer at
 * 10 keys per second while pi streams the reply.
 */
async function measureReply(
  tondo: TranscriptTondo,
  rate: Rate,
  cpuSlowdown = 1,
): Promise<StreamRun> {
  const { page } = tondo;
  const frameInterval = await measureFrameInterval(page);
  const memoryBefore = await measureMemory(tondo);
  await slowDownCpu(page, cpuSlowdown);
  const finished = await recordStream(page, FOLLOW_THRESHOLD_PX);
  await send(page, PROMPT);
  const streaming = page.locator("[data-streaming]");
  await expect(streaming).toBeAttached();
  await composer(page).focus();
  for (let word = 0; (await streaming.count()) > 0; word++) {
    await page.keyboard.type(WORDS[word % WORDS.length]!, { delay: 100 });
  }
  const record = await finished();
  await waitForIdle(page);
  const memoryAfter = await measureMemory(tondo);

  expect(record.streamedMs, "pi streamed the whole reply").toBeGreaterThanOrEqual(
    leastStreamMs(rate),
  );
  expect(record.keys, "the keys reached the page").toBeGreaterThan(0);
  expect(record.timedKeys, "Event Timing saw every key").toBeGreaterThanOrEqual(record.keys);
  const frameTimes = record.frames.slice(1).map((time, index) => time - record.frames[index]!);
  // Keys Event Timing didn't report took under 16 ms. They count as 0.
  const unreported = Math.max(0, record.keys - record.slowKeys.length);
  return {
    frameInterval,
    streamedMs: record.streamedMs,
    frames: record.frames.length,
    frameP95: percentile(frameTimes, 95),
    frameP99: percentile(frameTimes, 99),
    frameMax: Math.max(...frameTimes),
    longTasks: record.longTasks.filter((task) => task >= BUDGET.longTaskMs).length,
    longestTask: Math.max(0, ...record.longTasks),
    keys: record.keys,
    inputP95: percentile([...record.slowKeys, ...Array<number>(unreported).fill(0)], 95),
    slowFrames: record.slowFrames,
    longestLag: record.longestLag,
    memoryBefore,
    memoryAfter,
  };
}

/**
 * Opens a second thread while pi streams into the first, then clicks the
 * first in the sidebar.
 */
function measureSwitch(cpuSlowdown = 1): Promise<number> {
  return withTondo(1000, async (tondo) => {
    const { page } = tondo;
    await openTranscript(tondo);
    await send(page, PROMPT);
    await waitForReply(page, SWITCH_AT_CHARS);
    await newTranscriptThread(tondo);
    const streaming = threads(page).locator(`${THREAD_ROW}:not([aria-current])`);
    await expect(streaming.getByRole("img", { name: "Working" })).toBeVisible();
    await slowDownCpu(page, cpuSlowdown);
    return switchThread(page, streaming, FOLLOW_THRESHOLD_PX);
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
  const columns = [...RATES.map((rate) => results.streams[rate]), results.busy];
  const perStream = (
    label: string,
    budget: string,
    pick: (run: StreamRun) => number,
    format = time,
  ) =>
    `| ${label} | ${budget} | ${columns.map((column) => runs(column.map(pick), format)).join(" | ")} |`;
  const slow = (pick: (run: StreamRun) => number, format = time) =>
    RATES.map((rate) => {
      const run = results.slowdown.streams[rate];
      return run ? format(pick(run)) : "not run";
    }).join(" | ");
  const behindLabel = `Longest time more than ${FOLLOW_THRESHOLD_PX} px short of the end`;
  const intervals = RATES.flatMap((rate) => results.streams[rate].map((run) => run.frameInterval));

  return [
    `# Streaming perf report`,
    ``,
    `Machine: ${results.machine}. Frame interval ${intervals.length > 0 ? time(median(intervals)) : "not measured"}.`,
    `Medians of ${RUNS} runs, each run in parentheses. Memory counts Tondo's processes, not pi's.`,
    `Memory limits apply to single-thread total medians, compared before rounding.`,
    `In the last column, ${BUSY_THREADS - 1} other threads stream the reply too, with ${FOLLOW_UPS} follow-ups queued so they outlast the thread on screen.`,
    ``,
    `| Metric | Budget | 1,000 tok/s | 200 tok/s | 1,000 tok/s, ${BUSY_THREADS} threads streaming |`,
    `|---|---|---|---|---|`,
    perStream("Frame time p95", "16.7 ms or less", (run) => run.frameP95),
    perStream("Frame time p99", "33 ms or less", (run) => run.frameP99),
    perStream("Longest frame", "", (run) => run.frameMax),
    perStream("Long tasks of 100 ms or more", "none", (run) => run.longTasks, String),
    perStream("Longest task", "", (run) => run.longestTask, task),
    perStream(behindLabel, "100 ms or less", (run) => run.longestLag),
    perStream("Input to paint p95", "32 ms or less", (run) => run.inputP95, input),
    perStream("Keys typed", "", (run) => run.keys, String),
    perStream(
      "Memory, all processes, before",
      `${BUDGET.memoryBeforeMiB} MiB, single thread`,
      (run) => run.memoryBefore.total,
      mib,
    ),
    perStream(
      "Memory, all processes, after",
      `${BUDGET.memoryAfterMiB[1000]} / ${BUDGET.memoryAfterMiB[200]} MiB, single thread`,
      (run) => run.memoryAfter.total,
      mib,
    ),
    perStream("Memory, renderer, before", "baseline", (run) => run.memoryBefore.renderer, mib),
    perStream("Memory, renderer, after", "baseline", (run) => run.memoryAfter.renderer, mib),
    perStream("Memory, host, before", "", (run) => run.memoryBefore.host, mib),
    perStream("Memory, host, after", "", (run) => run.memoryAfter.host, mib),
    ``,
    `| Metric | Budget | Result |`,
    `|---|---|---|`,
    `| Switch to a thread whose pi is running | 100 ms or less | ${runs(results.switches, time)} |`,
    `| Cold start, window interactive | 1 s or less | ${runs(
      results.coldStarts.map((run) => run.interactiveMs),
      time,
    )} |`,
    `| Opening a project, to its transcript on screen (starts pi) | | ${runs(
      results.coldStarts.map((run) => run.openMs),
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
    `| ${behindLabel} | ${slow((run) => run.longestLag)} |`,
    `| Input to paint p95 | ${slow((run) => run.inputP95, input)} |`,
    ``,
    `Switch to a running thread at 4x: ${results.slowdown.switchMs === undefined ? "not run" : time(results.slowdown.switchMs)}.`,
    ``,
  ].join("\n");
}
