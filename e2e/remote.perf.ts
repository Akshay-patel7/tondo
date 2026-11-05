// oxlint-disable eslint/no-await-in-loop -- every sample owns the foreground app and measures alone.
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import type { RemoteStatus } from "../src/shared/remote";
import path from "node:path";
import { WebSocket } from "ws";
import { expect, test } from "@playwright/test";
import { PROTOCOL_VERSION as v, type HostMessage } from "../src/shared/protocol";
import { REMOTE_PORT } from "../src/shared/remote";
import {
  checkDisplay,
  measureMemory,
  median,
  percentile,
  perfRunDir,
  recordStream,
  switchThread,
  type Memory,
} from "./perf";
import { composer, longReply, send, waitForIdle } from "./pi";
import {
  FOLLOW_THRESHOLD_PX,
  launchOnTranscript,
  openTranscript,
  newTranscriptThread,
  waitForReply,
  type TranscriptTondo,
} from "./timeline";

type Mode = "disabled" | "enabled" | "connected" | "slow";
const RUNS = 3;
const BASE = `http://127.0.0.1:${REMOTE_PORT}`;
const results: {
  idle: Partial<Record<Mode, Memory[]>>;
  switches: number[];
  assetWarmups: number[];
  historyIndexes: number[];
  streaming: Partial<
    Record<
      Mode,
      {
        before: Memory;
        after: Memory;
        frameP95: number;
        frameP99: number;
        inputP95: number;
        longTasks: number;
        received: number;
      }[]
    >
  >;
} = { idle: {}, streaming: {}, switches: [], assetWarmups: [], historyIndexes: [] };

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  const dir = perfRunDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "remote-results.json"), JSON.stringify(results, null, 2));
});

// Match the phone's initial static requests without running a second renderer on
// the Mac. Include font assets and the real gzip path before measuring footprint.
async function warmBrowserAssets(): Promise<number> {
  const headers = { "Accept-Encoding": "gzip" };
  const page = await fetch(BASE, { headers });
  expect(page.status).toBe(200);
  const html = await page.text();
  const files = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="((?:\.?\/)?assets\/[^"]+\.(?:js|css))"/g)].map(
        (match) => new URL(match[1]!, BASE).href,
      ),
    ),
  ];
  expect(files.length).toBeGreaterThan(0);
  const fonts = new Set<string>();
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map(async (file) => {
        const response = await fetch(file, { headers });
        expect(response.status).toBe(200);
        if (file.endsWith(".css")) {
          for (const match of (await response.text()).matchAll(
            /url\(["']?([^"')]+\.woff2)["']?\)/g,
          )) {
            const url = new URL(match[1]!, file);
            if (url.origin === BASE) fonts.add(url.href);
          }
        } else await response.arrayBuffer();
      }),
    );
  }
  const fontFiles = [...fonts];
  for (let i = 0; i < fontFiles.length; i += 8) {
    await Promise.all(
      fontFiles.slice(i, i + 8).map(async (file) => {
        const response = await fetch(file, { headers });
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }),
    );
  }
  return 1 + files.length + fontFiles.length;
}

async function setup(mode: Mode) {
  const tondo = await launchOnTranscript({
    script: { tokensPerSecond: 1000, responses: [longReply()] },
    exposeGc: true,
    settings: { remoteAccess: mode !== "disabled" },
  });
  let ws: WebSocket | undefined;
  let received = 0;
  try {
    await checkDisplay(tondo.page);
    await openTranscript(tondo);
    // Match the existing startup benchmark: the saved setting is already enabled.
    // Opening Settings has a separate, pre-existing footprint on the control build.
    if (mode !== "disabled") {
      const status = () =>
        tondo.app.evaluate(() =>
          (
            globalThis as unknown as { tondoTest: { remoteStatus: () => RemoteStatus } }
          ).tondoTest.remoteStatus(),
        );
      await expect.poll(async () => (await status()).state).toBe("ready");
      const remote = await status();
      if (remote.state !== "ready") throw new Error("Remote gateway did not become ready");
      if (mode === "connected" || mode === "slow") {
        results.assetWarmups.push(await warmBrowserAssets());
        // The synthetic fork is sidebar-hidden before a first edit. Read its test-owned id only.
        const db = new DatabaseSync(path.join(tondo.profileDir, "tondo.sqlite"), {
          readOnly: true,
        });
        const { id: threadId } = db.prepare("SELECT id FROM threads LIMIT 1").get() as {
          id: string;
        };
        db.close();
        const paired = await fetch(`${BASE}/pair`, {
          method: "POST",
          headers: { Origin: BASE, "Content-Type": "application/json" },
          body: JSON.stringify({ code: remote.code }),
        });
        expect(paired.status).toBe(204);
        ws = new WebSocket(`${BASE.replace("http:", "ws:")}/socket`, {
          origin: BASE,
          headers: { Cookie: paired.headers.get("set-cookie")!.split(";", 1)[0]! },
        });
        let requestedHistory = false;
        const selected = new Promise<void>((resolve, reject) =>
          ws!.on("message", (data) => {
            received++;
            const message = JSON.parse(data.toString()) as HostMessage;
            if (message.type === "snapshot" && message.thread?.id === threadId) {
              if (!message.historyOmitted) resolve();
              else if (!requestedHistory) {
                // HistoryTimeline loads this index on mount for the bounded phone snapshot.
                requestedHistory = true;
                ws!.send(
                  JSON.stringify({
                    id: "history",
                    message: { v, type: "history-index", threadId, id: "initial-history" },
                  }),
                );
              }
            }
            if (message.type === "history-result" && message.id === "initial-history") {
              if (message.error || message.result?.kind !== "index")
                reject(new Error(message.error ?? "Missing history index"));
              else {
                results.historyIndexes.push(message.result.index.prompts.length);
                resolve();
              }
            }
            if (message.type === "remote-result" && message.id === "history" && message.error)
              reject(new Error(message.error));
          }),
        );
        await once(ws, "open");
        ws.send(JSON.stringify({ id: "select", message: { v, type: "open-thread", threadId } }));
        await selected;
      }
    }
    await expect(tondo.page.getByTestId("timeline")).toBeVisible();
    return {
      tondo,
      ws,
      received: () => received,
      async close() {
        ws?.terminate();
        await tondo.close();
      },
    };
  } catch (error) {
    ws?.terminate();
    await tondo.close();
    throw error;
  }
}

for (const mode of ["disabled", "enabled", "connected"] as const) {
  test(`remote idle: ${mode}`, async () => {
    const samples: Memory[] = [];
    results.idle[mode] = samples;
    for (let run = 0; run < RUNS; run++) {
      const sample = await setup(mode);
      try {
        samples.push(await measureMemory(sample.tondo));
      } finally {
        await sample.close();
      }
    }
    // The existing idle limit is unchanged and includes the gateway worker's heap.
    expect(
      median(samples.map((sample) => sample.total)) / 2 ** 20,
      `total idle footprint with remote ${mode}`,
    ).toBeLessThanOrEqual(279.4);
  });
}

async function stream(tondo: TranscriptTondo) {
  const finished = await recordStream(tondo.page, FOLLOW_THRESHOLD_PX);
  await send(tondo.page, "Explain the parser rewrite.");
  const streaming = tondo.page.locator("[data-streaming]");
  await expect(streaming).toBeAttached();
  await composer(tondo.page).focus();
  while (await streaming.count())
    await tondo.page.keyboard.type("Still responsive. ", { delay: 100 });
  const record = await finished();
  await waitForIdle(tondo.page);
  const frames = record.frames.slice(1).map((time, index) => time - record.frames[index]!);
  const unreported = Math.max(0, record.keys - record.slowKeys.length);
  expect(record.keys).toBeGreaterThan(0);
  expect(record.timedKeys).toBeGreaterThanOrEqual(record.keys);
  const characters = longReply().content.reduce(
    (total, block) => total + (block.type === "text" ? block.text.length : 0),
    0,
  );
  expect(record.streamedMs, "the full reply streamed at 1,000 tokens/s").toBeGreaterThanOrEqual(
    characters / 4,
  );
  return {
    frameP95: percentile(frames, 95),
    frameP99: percentile(frames, 99),
    inputP95: percentile([...record.slowKeys, ...Array<number>(unreported).fill(0)], 95),
    longTasks: record.longTasks.filter((duration) => duration >= 100).length,
  };
}

test("switching desktop threads while the phone watches the streaming thread", async () => {
  for (let run = 0; run < RUNS; run++) {
    const sample = await setup("connected");
    try {
      await send(sample.tondo.page, "Stream for the phone while I switch threads.");
      await waitForReply(sample.tondo.page, 6000);
      const first = sample.tondo.page.locator("button[data-thread-id]").first();
      const id = await first.getAttribute("data-thread-id");
      await newTranscriptThread(sample.tondo);
      results.switches.push(
        await switchThread(
          sample.tondo.page,
          sample.tondo.page.locator(`button[data-thread-id="${id}"]`),
          FOLLOW_THRESHOLD_PX,
        ),
      );
    } finally {
      await sample.close();
    }
  }
  expect(median(results.switches)).toBeLessThanOrEqual(100);
});

for (const mode of ["connected", "slow"] as const) {
  test(`remote streaming: ${mode}`, async () => {
    const samples: NonNullable<typeof results.streaming.connected> = [];
    results.streaming[mode] = samples;
    for (let run = 0; run < RUNS; run++) {
      const sample = await setup(mode);
      try {
        const before = await measureMemory(sample.tondo);
        if (mode === "slow") sample.ws?.pause();
        const timing = await stream(sample.tondo);
        sample.ws?.resume();
        const after = await measureMemory(sample.tondo);
        if (mode === "connected") {
          expect(sample.ws?.readyState, "the healthy phone remains connected").toBe(WebSocket.OPEN);
          expect(
            sample.received(),
            "the phone received live frames throughout the stream",
          ).toBeGreaterThan(10);
        }
        samples.push({ before, after, ...timing, received: sample.received() });
      } finally {
        await sample.close();
      }
    }
    expect(median(samples.map((sample) => sample.frameP95))).toBeLessThanOrEqual(16.7);
    expect(median(samples.map((sample) => sample.frameP99))).toBeLessThanOrEqual(33);
    expect(median(samples.map((sample) => sample.inputP95))).toBeLessThanOrEqual(32);
    expect(median(samples.map((sample) => sample.longTasks))).toBe(0);
    expect(median(samples.map((sample) => sample.before.total)) / 2 ** 20).toBeLessThanOrEqual(
      279.4,
    );
    expect(median(samples.map((sample) => sample.after.total)) / 2 ** 20).toBeLessThanOrEqual(
      510.4,
    );
  });
}
