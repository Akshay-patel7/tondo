import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { parseFixture } from "./fixture";
import { applyEvents, threadFromMessages, type PiMessage } from "./thread";

const fixturesDir = path.resolve(import.meta.dirname, "../../fixtures");
const reply = parseFixture(readFileSync(path.join(fixturesDir, "stream-1000.jsonl"), "utf8")).map(
  (entry) => entry.event,
);
const { messages } = JSON.parse(
  readFileSync(path.join(fixturesDir, "transcript-1000.json"), "utf8"),
) as { messages: PiMessage[] };

test("reducer throughput", async ({ bench }) => {
  const results = await bench.compare(
    bench("20,000-token reply into an empty thread", () => {
      applyEvents(threadFromMessages([]), reply);
    }),
    bench("20,000-token reply into the 1,000-message transcript", () => {
      applyEvents(threadFromMessages(messages), reply);
    }),
  );

  for (const name of [
    "20,000-token reply into an empty thread",
    "20,000-token reply into the 1,000-message transcript",
  ] as const) {
    const eventsPerSecond = results.get(name).throughput.mean * reply.length;
    console.info(`${name}: ${Math.round(eventsPerSecond).toLocaleString("en-US")} events/s`);
    // pi sends about 220 events a second at 1,000 tok/s. The floor leaves
    // the reducer 450 times that.
    expect(eventsPerSecond).toBeGreaterThan(100_000);
  }
});
