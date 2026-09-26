import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { parseFixture } from "../src/shared/fixture";
import type { FixtureName } from "../src/renderer/player/protocol";
import type { Tondo } from "./launch";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");

/** Nearest-rank percentile, so every result is a value that was measured. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error(`No values to take the p${p} of`);
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/** How long a fixture takes to play at the recorded pace, in milliseconds. */
export async function fixtureDuration(fixture: FixtureName): Promise<number> {
  const text = await readFile(path.join(repoRoot, "fixtures", `${fixture}.jsonl`), "utf8");
  const last = parseFixture(text).at(-1);
  if (!last) throw new Error(`fixtures/${fixture}.jsonl has no events`);
  return last.t;
}

/** The display's frame interval, from the median gap between 60 idle frames. */
export function measureFrameInterval(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = [];
        const onFrame = (time: number) => {
          times.push(time);
          if (times.length <= 60) {
            requestAnimationFrame(onFrame);
            return;
          }
          const gaps = times.slice(1).map((later, index) => later - times[index]!);
          resolve(gaps.toSorted((a, b) => a - b)[gaps.length >> 1]!);
        };
        requestAnimationFrame(onFrame);
      }),
  );
}

/** What the page saw during one playback. */
export interface PlaybackRecord {
  /** From the first frame the player reported playing to the first it reported idle. */
  playedMs: number;
  /** requestAnimationFrame timestamps. */
  frames: number[];
  /** Long task durations, 50 ms or more. */
  longTasks: number[];
  /** The five slowest animation frames, with the script that ran longest in each. */
  slowFrames: { duration: number; blocking: number; script: string }[];
  /** Keys pressed during the playback. */
  keys: number;
  /** Keydowns Event Timing counted from the start of recording, to prove it saw the keys. */
  timedKeys: number;
  /**
   * Input to paint for each key that took 16 ms or more. Event Timing doesn't
   * report faster ones, so there are `keys` minus this many of those.
   */
  slowKeys: number[];
  /** The longest the view stayed more than `bottomPx` short of the end, in ms. */
  longestLag: number;
}

// TypeScript's DOM types don't cover Long Animation Frames yet.
interface LongAnimationFrame extends PerformanceEntry {
  blockingDuration: number;
  scripts: { invoker: string; sourceFunctionName: string; duration: number }[];
}

/**
 * Starts recording in the page, before the test presses Play. Returns a
 * function that waits for the player to finish and returns the record.
 */
export async function recordPlayback(
  page: Page,
  bottomPx: number,
): Promise<() => Promise<PlaybackRecord>> {
  const handle = await page.evaluateHandle((threshold) => {
    const player = document.querySelector<HTMLElement>("[data-testid=player]");
    // Legend List's scroll element is the timeline's only child.
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!player || !scroller) throw new Error("The player or the timeline isn't on the page");

    // oxlint-disable-next-line unicorn/consistent-function-scoping -- the page gets this function as source, so its helpers must live inside it.
    const observe = (type: string, init?: { durationThreshold: number }) => {
      const entries: PerformanceEntry[] = [];
      const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
      observer.observe({ type, ...init } as PerformanceObserverInit);
      // Entries not yet delivered to the callback come from takeRecords().
      return () => {
        entries.push(...observer.takeRecords());
        observer.disconnect();
        return entries;
      };
    };
    const stopLongTasks = observe("longtask");
    const stopLongFrames = observe("long-animation-frame");
    // 16 ms is the lowest threshold Event Timing accepts.
    const stopEvents = observe("event", { durationThreshold: 16 });
    const timedKeysBefore = performance.eventCounts.get("keydown") ?? 0;
    const keyTimes: number[] = [];
    const onKey = (event: KeyboardEvent) => keyTimes.push(event.timeStamp);
    addEventListener("keydown", onKey, { capture: true });

    // How long the view trails the end, checked after each frame paints.
    let behindSince: number | null = null;
    let longestLag = 0;
    const checkGap = () => {
      const now = performance.now();
      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (gap > threshold) {
        behindSince ??= now;
      } else if (behindSince !== null) {
        longestLag = Math.max(longestLag, now - behindSince);
        behindSince = null;
      }
    };

    const frames: number[] = [];
    const done = new Promise<PlaybackRecord>((resolve) => {
      const onFrame = (time: number) => {
        const playing = player.dataset.status === "playing";
        if (playing || frames.length > 0) frames.push(time);
        if (frames.length > 0 && !playing) {
          resolve(finish(frames[0]!, time));
          return;
        }
        if (playing) setTimeout(checkGap);
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
    });

    const finish = (start: number, end: number): PlaybackRecord => {
      removeEventListener("keydown", onKey, { capture: true });
      if (behindSince !== null) longestLag = Math.max(longestLag, end - behindSince);
      const within = (entry: PerformanceEntry) => entry.startTime >= start && entry.startTime < end;
      const slowKeys = new Map<number, number>();
      for (const entry of stopEvents() as PerformanceEventTiming[]) {
        if (!entry.name.startsWith("key") || entry.interactionId === 0 || !within(entry)) continue;
        slowKeys.set(
          entry.interactionId,
          Math.max(slowKeys.get(entry.interactionId) ?? 0, entry.duration),
        );
      }
      const slowFrames = (stopLongFrames() as LongAnimationFrame[])
        .filter(within)
        .toSorted((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map((frame) => {
          const script = frame.scripts.toSorted((a, b) => b.duration - a.duration)[0];
          return {
            duration: frame.duration,
            blocking: frame.blockingDuration,
            script: script
              ? `${script.invoker} ${script.sourceFunctionName} ${Math.round(script.duration)} ms`
              : "",
          };
        });
      return {
        playedMs: end - start,
        frames,
        longTasks: stopLongTasks()
          .filter(within)
          .map((entry) => entry.duration),
        slowFrames,
        keys: keyTimes.filter((time) => time >= start && time < end).length,
        timedKeys: (performance.eventCounts.get("keydown") ?? 0) - timedKeysBefore,
        slowKeys: [...slowKeys.values()],
        longestLag,
      };
    };

    return { done };
  }, bottomPx);
  return () => handle.evaluate(({ done }) => done);
}

/**
 * Starts watching for the Reopen button, which stands in for switching to a
 * thread. Returns a function that resolves with the milliseconds from the
 * click to the paint of the first frame where the new timeline shows the
 * streaming row at the bottom.
 */
export async function recordSwitch(page: Page, bottomPx: number): Promise<() => Promise<number>> {
  const handle = await page.evaluateHandle((threshold) => {
    const before = document.querySelector("[data-testid=timeline]");
    const reopen = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Reopen",
    );
    if (!before || !reopen) throw new Error("The timeline or the Reopen button is missing");

    const done = new Promise<number>((resolve) => {
      reopen.addEventListener(
        "click",
        (click) => {
          let atBottom = false;
          const onFrame = (time: number) => {
            // The state checked in the previous frame painted before this one began.
            if (atBottom) {
              resolve(time - click.timeStamp);
              return;
            }
            const timeline = document.querySelector("[data-testid=timeline]");
            const scroller = timeline?.firstElementChild;
            const streaming = timeline?.querySelector("[data-streaming]");
            if (timeline !== before && scroller && streaming) {
              const view = scroller.getBoundingClientRect();
              const row = streaming.getBoundingClientRect();
              const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
              atBottom = gap <= threshold && row.bottom > view.top && row.top < view.bottom;
            }
            requestAnimationFrame(onFrame);
          };
          requestAnimationFrame(onFrame);
        },
        { once: true },
      );
    });
    return { done };
  }, bottomPx);
  return () => handle.evaluate(({ done }) => done);
}

/** Bytes, from macOS `footprint`: all of Tondo's processes, and the renderer alone. */
export interface Memory {
  total: number;
  renderer: number;
}

/** V8's `gc()`, when the app was launched with `launchTondo({ exposeGc: true })`. */
type Gc = (options: { type: "major"; execution: "async"; flavor: "last-resort" }) => Promise<void>;

/**
 * Collects garbage in the JavaScript heap it runs in. It's the collection
 * DevTools' "Collect garbage" runs, V8's last-resort one, and it runs as a
 * task so nothing on the stack keeps garbage alive.
 */
const collectGarbageHere = async () => {
  const { gc } = globalThis as typeof globalThis & { gc?: Gc };
  if (!gc) throw new Error("gc() isn't exposed. Launch with launchTondo({ exposeGc: true }).");
  await gc({ type: "major", execution: "async", flavor: "last-resort" });
};

/** Collects garbage in every JavaScript heap: the main process, the page and its workers. */
async function collectGarbage({ app, page }: Tondo): Promise<void> {
  await Promise.all([
    app.evaluate(collectGarbageHere),
    page.evaluate(collectGarbageHere),
    ...page.workers().map((worker) => worker.evaluate(collectGarbageHere)),
  ]);
}

/**
 * Reads memory right after collecting garbage, so the numbers count what
 * Tondo keeps rather than garbage V8 hasn't collected yet.
 */
export async function measureMemory(tondo: Tondo): Promise<Memory> {
  await collectGarbage(tondo);
  const { pids, renderer } = await tondo.app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    pids: electronApp.getAppMetrics().map((metric) => metric.pid),
    renderer: BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId(),
  }));
  const dir = await mkdtemp(path.join(tmpdir(), "tondo-footprint-"));
  try {
    const file = path.join(dir, "footprint.json");
    const targets = pids.flatMap((pid) => ["-p", String(pid)]);
    await execFileAsync("footprint", ["-f", "bytes", "--noCategories", "-j", file, ...targets]);
    const report = JSON.parse(await readFile(file, "utf8")) as {
      "total footprint": number;
      processes: { pid: number; footprint: number }[];
    };
    const rendererBytes = report.processes.find((process) => process.pid === renderer)?.footprint;
    if (rendererBytes === undefined)
      throw new Error(`footprint didn't report the renderer, pid ${renderer}`);
    return { total: report["total footprint"], renderer: rendererBytes };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
