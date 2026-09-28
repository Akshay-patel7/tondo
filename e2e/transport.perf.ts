// oxlint-disable eslint/no-await-in-loop -- each measurement waits for the one before it.
// Stage 2's transport measurements from docs/plan.md: a message's round trip
// from the page to the host and back, and how long the host's snapshot of a
// thread takes to reach the page. `pnpm perf` runs them with the other perf
// files and writes transport.json and transport.md to the same folder.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PROTOCOL_VERSION, type HostMessage } from "../src/shared/protocol";
import { listenOnPort, median, percentile, perfRunDir, type PerfWindow } from "./perf";
import {
  launchOnTranscript,
  newTranscriptThread,
  openTranscript,
  TRANSCRIPT_MESSAGES,
  type TranscriptTondo,
} from "./timeline";

const PINGS = 1000;
/** Round trips that warm up the code on both ends first and don't count. */
const WARM_UP_PINGS = 100;
/** Snapshots per thread, after one that doesn't count. */
const SNAPSHOTS = 10;
/** The recorded transcript, and a session that repeats it to 5,000 messages. */
const THREAD_SIZES = [1000, 5000] as const;
const BUDGET = { roundTripP95: 1 };

interface SnapshotRun {
  /** From sending open-thread until the snapshot's data is in hand. */
  totalMs: number;
  /** From sending open-thread until the page's first listener runs. */
  arrivedMs: number;
  /** Reading `event.data`, which deserializes the snapshot if it isn't already. */
  readMs: number;
}

interface SnapshotResult {
  messages: number;
  /** The snapshot's length as JSON, for scale. */
  jsonChars: number;
  runs: SnapshotRun[];
}

const results = {
  /** The smallest step of the page's clock, which bounds single readings. */
  clockStepMs: undefined as number | undefined,
  roundTrips: [] as number[],
  /** The counted round trips back to back, read once, so their mean doesn't depend on the clock's step. */
  roundTripsTotalMs: undefined as number | undefined,
  snapshots: {} as Partial<Record<(typeof THREAD_SIZES)[number], SnapshotResult>>,
};

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const dir = perfRunDir();
  await mkdir(dir, { recursive: true });
  const report = formatReport();
  await writeFile(path.join(dir, "transport.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(dir, "transport.md"), report);
  console.log(`\n${report}\nWritten to ${dir}`);
});

test("round trip from the page to the host and back", async () => {
  await withTondo(1000, async ({ page }) => {
    results.clockStepMs = await measureClockStep(page);
    const { times, totalMs } = await measureRoundTrips(page);
    results.roundTrips = times;
    results.roundTripsTotalMs = totalMs;
  });
});

for (const size of THREAD_SIZES) {
  test(`snapshot of a ${size.toLocaleString("en-US")}-message thread`, async () => {
    await withTondo(size, async (tondo) => {
      await newTranscriptThread(tondo);
      const snapshot = await measureSnapshots(tondo.page);
      expect(snapshot.messages, "the host opened a thread of that size").toBe(size);
      results.snapshots[size] = snapshot;
    });
  });
}

test("budgets", () => {
  expect(results.roundTrips.length, "round trips measured").toBe(PINGS);
  expect
    .soft(percentile(results.roundTrips, 95), "round trip p95")
    .toBeLessThan(BUDGET.roundTripP95);
});

/**
 * Launches Tondo in front with listenOnPort's script, opens a thread of
 * `messages` messages, runs `body` and quits.
 */
async function withTondo(
  messages: number,
  body: (tondo: TranscriptTondo) => Promise<void>,
): Promise<void> {
  const tondo = await launchOnTranscript({
    script: { responses: [] },
    copies: messages / TRANSCRIPT_MESSAGES,
  });
  try {
    await listenOnPort(tondo);
    await openTranscript(tondo);
    await body(tondo);
  } finally {
    await tondo.close();
  }
}

function measureClockStep(page: Page): Promise<number> {
  return page.evaluate(() => {
    let step = Infinity;
    for (let sample = 0; sample < 100; sample++) {
      const start = performance.now();
      let now = start;
      while (now === start) now = performance.now();
      step = Math.min(step, now - start);
    }
    return step;
  });
}

function measureRoundTrips(page: Page): Promise<{ times: number[]; totalMs: number }> {
  return page.evaluate(
    async ({ pings, warmUp, v }) => {
      const perf = (window as PerfWindow).tondoPerf;
      if (!perf) throw new Error("The perf script didn't get the page's port");
      const { port } = perf;
      const times: number[] = [];
      let countingSince = 0;
      for (let id = 0; id < warmUp + pings; id++) {
        const sent = performance.now();
        if (id === warmUp) countingSince = sent;
        await new Promise<void>((resolve) => {
          perf.onMessage = ({ data }) => {
            if (data.type === "pong" && data.id === id) resolve();
          };
          port.postMessage({ v, type: "ping", id });
        });
        if (id >= warmUp) times.push(performance.now() - sent);
      }
      const totalMs = performance.now() - countingSince;
      perf.onMessage = undefined;
      return { times, totalMs };
    },
    { pings: PINGS, warmUp: WARM_UP_PINGS, v: PROTOCOL_VERSION },
  );
}

/**
 * Opens the two threads the host has shown the page in turn, SNAPSHOTS times
 * plus one to warm up, and times the snapshot the host answers each with.
 */
function measureSnapshots(page: Page): Promise<SnapshotResult> {
  return page.evaluate(
    async ({ snapshots, v }) => {
      const perf = (window as PerfWindow).tondoPerf;
      if (!perf) throw new Error("The perf script didn't get the page's port");
      // The second is on screen.
      const { port, threads } = perf;
      if (threads.length !== 2) throw new Error(`The host showed ${threads.length} threads, not 2`);
      const result: SnapshotResult = { messages: 0, jsonChars: 0, runs: [] };
      for (let run = 0; run <= snapshots; run++) {
        // Let the app finish showing the snapshot before, so the page is idle.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestIdleCallback(resolve));
        const sent = performance.now();
        const { measured, snapshot } = await new Promise<{
          measured: SnapshotRun;
          snapshot: Extract<HostMessage, { type: "snapshot" }>;
        }>((resolve) => {
          perf.onMessage = (event) => {
            const arrived = performance.now();
            const { data } = event;
            const read = performance.now();
            if (data.type !== "snapshot") return;
            resolve({
              measured: { totalMs: read - sent, arrivedMs: arrived - sent, readMs: read - arrived },
              snapshot: data,
            });
          };
          port.postMessage({ v, type: "open-thread", threadId: threads[run % 2] });
        });
        if (run === 0) {
          result.messages = snapshot.state.messages.length;
          result.jsonChars = JSON.stringify(snapshot).length;
        } else {
          result.runs.push(measured);
        }
      }
      perf.onMessage = undefined;
      return result;
    },
    { snapshots: SNAPSHOTS, v: PROTOCOL_VERSION },
  );
}

const ms = (value: number) => `${value < 1 ? value.toFixed(2) : value.toFixed(1)} ms`;
const mb = (chars: number) => `${(chars / 1e6).toFixed(1)} MB`;

function formatReport(): string {
  const trips = results.roundTrips;
  const roundTrip =
    trips.length === 0
      ? "not run"
      : `${ms(percentile(trips, 95))} (mean ${ms((results.roundTripsTotalMs ?? Number.NaN) / trips.length)}, p99 ${ms(percentile(trips, 99))}, longest ${ms(Math.max(...trips))})`;
  const snapshotRows = THREAD_SIZES.map((size) => {
    const snapshot = results.snapshots[size];
    const label = `Snapshot of ${size.toLocaleString("en-US")} messages`;
    if (!snapshot) return `| ${label} | | not run |`;
    const total = snapshot.runs.map((run) => run.totalMs);
    const read = snapshot.runs.map((run) => run.readMs);
    return (
      `| ${label}, ${mb(snapshot.jsonChars)} as JSON | | ${ms(median(total))} ` +
      `(longest ${ms(Math.max(...total))}; reading event.data took ${ms(median(read))} of it) |`
    );
  });
  return [
    `# Transport perf report`,
    ``,
    `The page's clock steps by ${results.clockStepMs === undefined ? "an unmeasured amount" : ms(results.clockStepMs)}, which bounds each single reading.`,
    `Round trips: ${WARM_UP_PINGS} to warm up, then ${PINGS} counted, one at a time.`,
    `Snapshots: the median of ${SNAPSHOTS} after one to warm up, switching between two threads of that size once the page is idle, from sending open-thread until the page's first listener has the data.`,
    ``,
    `| Metric | Budget | Result |`,
    `|---|---|---|`,
    `| Round trip p95 | under 1 ms | ${roundTrip} |`,
    ...snapshotRows,
    ``,
  ].join("\n");
}
