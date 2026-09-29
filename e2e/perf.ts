import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { PORT_MESSAGE, type HostMessage } from "../src/shared/protocol";
import type { Tondo } from "./launch";

const execFileAsync = promisify(execFile);

/** Nearest-rank percentile, so every result is a value that was measured. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error(`No values to take the p${p} of`);
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
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

/**
 * The display the budgets and the Stage 1 baseline were measured on: the
 * MacBook's built-in Retina, at 2x and 120 Hz.
 */
const PERF_DISPLAY = { devicePixelRatio: 2, frameIntervalMs: 1000 / 120 };

/**
 * Fails unless Tondo's window is on a display like PERF_DISPLAY. On a 1x
 * display the window has a quarter of the pixels, so memory reads low, and on
 * another refresh rate frame times don't compare.
 */
export async function checkDisplay(page: Page): Promise<void> {
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  const interval = await measureFrameInterval(page);
  const { devicePixelRatio, frameIntervalMs } = PERF_DISPLAY;
  if (ratio !== devicePixelRatio || Math.abs(interval - frameIntervalMs) > 0.5) {
    throw new Error(
      `pnpm perf needs Tondo's window on a ${devicePixelRatio}x display refreshing every ` +
        `${frameIntervalMs.toFixed(1)} ms, like the built-in Retina the budgets were measured on. ` +
        `It got ${ratio}x and ${interval.toFixed(1)} ms. Make the built-in display the main one and run again.`,
    );
  }
}

/** What the page saw while pi streamed one reply. */
export interface StreamRecord {
  /**
   * From the Enter that sent the prompt until the page saw the reply finished.
   * pi gets the prompt after the Enter, so this is at least the time the
   * model spent streaming.
   */
  streamedMs: number;
  /** requestAnimationFrame timestamps. */
  frames: number[];
  /** Long task durations, 50 ms or more. */
  longTasks: number[];
  /** The five slowest animation frames, with the script that ran longest in each. */
  slowFrames: { duration: number; blocking: number; script: string }[];
  /** Keys pressed while the reply streamed. */
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
 * Starts recording in the page, before the test sends the prompt. It records
 * from the first frame that shows pi's reply streaming until the first frame
 * that shows it finished. Returns a function that waits for that frame and
 * returns the record.
 */
export async function recordStream(
  page: Page,
  bottomPx: number,
): Promise<() => Promise<StreamRecord>> {
  const handle = await page.evaluateHandle((threshold) => {
    // Legend List's scroll element is the timeline's only child.
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!scroller) throw new Error("The timeline isn't on the page");

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
    let sentAt: number | undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") sentAt ??= event.timeStamp;
      keyTimes.push(event.timeStamp);
    };
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
    const done = new Promise<StreamRecord>((resolve) => {
      const onFrame = (time: number) => {
        const streaming = document.querySelector("[data-streaming]") !== null;
        if (streaming || frames.length > 0) frames.push(time);
        if (frames.length > 0 && !streaming) {
          resolve(finish(frames[0]!, time));
          return;
        }
        if (streaming) setTimeout(checkGap);
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
    });

    const finish = (start: number, end: number): StreamRecord => {
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
      // `end` is when the frame began, which can be before the reply finished.
      const finishedAt = performance.now();
      return {
        streamedMs: sentAt === undefined ? Number.NaN : finishedAt - sentAt,
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

/** What listenOnPort's script leaves on the page. */
export interface PerfWindow extends Window {
  tondoPerf?: {
    port: MessagePort;
    /** The ids of the threads the host has put on screen, in the order it first did. */
    threads: string[];
    /** Gets each message from the host before the app's own listener does. */
    onMessage?: ((event: MessageEvent<HostMessage>) => void) | undefined;
  };
}

/**
 * Reloads the page with a script that takes the page's port to the host the
 * way the app does, and listens on it before the app does. A measurement can
 * then send the host messages itself, and see each message from the host
 * before the app starts working on it.
 */
export async function listenOnPort({ app, page }: Tondo): Promise<void> {
  await app.context().addInitScript((portMessage) => {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data !== portMessage) return;
      const [port] = event.ports;
      if (!port) return;
      const perf: NonNullable<PerfWindow["tondoPerf"]> = { port, threads: [] };
      (window as PerfWindow).tondoPerf = perf;
      port.addEventListener("message", (message: MessageEvent<HostMessage>) => {
        perf.onMessage?.(message);
        // Read after onMessage, which times reading the data.
        const { data } = message;
        if (data.type === "snapshot" && data.thread && !perf.threads.includes(data.thread.id)) {
          perf.threads.push(data.thread.id);
        }
      });
    });
  }, PORT_MESSAGE);
  await page.reload();
  await page.waitForFunction(() => (window as PerfWindow).tondoPerf !== undefined);
}

/**
 * Clicks `row`, a thread in the sidebar whose pi is streaming a reply, and
 * the page opens the snapshot the host answers with in a new timeline.
 * Resolves with the milliseconds from the click until the paint of the first
 * frame where the new timeline shows the streaming reply at the bottom.
 * Legend List renders rows transparent until its opening scroll finishes, so
 * the reply must also be opaque.
 */
export async function switchThread(page: Page, row: Locator, bottomPx: number): Promise<number> {
  const switched = await page.evaluateHandle((threshold) => {
    const before = document.querySelector("[data-testid=timeline]");
    if (!before) throw new Error("The timeline isn't on the page");
    const done = new Promise<number>((resolve) => {
      const onClick = (click: MouseEvent) => {
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
            const reply = streaming.getBoundingClientRect();
            const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            let opaque = true;
            for (let at: Element | null = streaming; at && opaque; at = at.parentElement) {
              opaque = getComputedStyle(at).opacity === "1";
            }
            atBottom =
              opaque && gap <= threshold && reply.bottom > view.top && reply.top < view.bottom;
          }
          requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      };
      addEventListener("click", onClick, { capture: true, once: true });
    });
    return { done };
  }, bottomPx);
  await row.click();
  return switched.evaluate(({ done }) => done);
}

/** The folder this `pnpm perf` run writes its results to, named by playwright.perf.config.ts. */
export function perfRunDir(): string {
  const dir = process.env.TONDO_PERF_DIR;
  if (!dir) throw new Error("TONDO_PERF_DIR isn't set. Run the perf files with `pnpm perf`.");
  return dir;
}

/** Bytes, from macOS `footprint`: all of Tondo's processes, the renderer, and the host. */
export interface Memory {
  total: number;
  renderer: number;
  host: number;
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

/**
 * Collects garbage in every JavaScript heap: the main process, the host, the
 * page and its workers, such as @pierre/diffs's pool. Main can reach the host's
 * heap only when it has `gc()` itself.
 */
async function collectGarbage({ app, page }: Tondo): Promise<void> {
  await Promise.all([
    app.evaluate(collectGarbageHere),
    app.evaluate(() => {
      const main = globalThis as typeof globalThis & {
        tondoCollectHostGarbage?: () => Promise<void>;
      };
      if (!main.tondoCollectHostGarbage) {
        throw new Error(
          "Main can't collect the host's garbage. Launch with launchTondo({ exposeGc: true }).",
        );
      }
      return main.tondoCollectHostGarbage();
    }),
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
  const { pids, renderer, host } = await tondo.app.evaluate(
    ({ app: electronApp, BrowserWindow }) => {
      const metrics = electronApp.getAppMetrics();
      return {
        pids: metrics.map((metric) => metric.pid),
        renderer: BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId(),
        host: metrics.find((metric) => metric.name === "Tondo Host")?.pid,
      };
    },
  );
  const dir = await mkdtemp(path.join(tmpdir(), "tondo-footprint-"));
  try {
    const file = path.join(dir, "footprint.json");
    const targets = pids.flatMap((pid) => ["-p", String(pid)]);
    await execFileAsync("footprint", ["-f", "bytes", "--noCategories", "-j", file, ...targets]);
    const report = JSON.parse(await readFile(file, "utf8")) as {
      "total footprint": number;
      processes: { pid: number; footprint: number }[];
    };
    const bytesOf = (name: string, pid: number | undefined) => {
      const bytes = report.processes.find((process) => process.pid === pid)?.footprint;
      if (bytes === undefined) throw new Error(`footprint didn't report the ${name}, pid ${pid}`);
      return bytes;
    };
    return {
      total: report["total footprint"],
      renderer: bytesOf("renderer", renderer),
      host: bytesOf("host", host),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
