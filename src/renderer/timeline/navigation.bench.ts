import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { PiMessage } from "../../shared/thread";
import { navigationPreview, navigationTargets } from "./navigation";
import { timelineRows } from "./turns";

const { messages } = JSON.parse(
  readFileSync(new URL("../../../fixtures/transcript-1000.json", import.meta.url), "utf8"),
) as { messages: PiMessage[] };
const rows = timelineRows(Array.from({ length: 5 }, () => messages).flat());
const target = navigationTargets(rows)[0]!;
const cases = [4096, 8 * 1024 * 1024].map((size) => ({
  name: `hover preview, ${size / 1024} KiB prompt`,
  target: {
    ...target,
    prompt: { ...target.prompt, content: "text ".repeat(Math.ceil(size / 5)).slice(0, size) },
  },
}));

test("history navigation keeps indexing off the streaming path and bounds previews", async ({
  bench,
}) => {
  const results = await bench.compare(
    bench("index 5,000 messages, completed-message changes only", () => navigationTargets(rows)),
    ...cases.map(({ name, target: item }) => bench(name, () => navigationPreview(item))),
  );
  for (const name of [
    "index 5,000 messages, completed-message changes only",
    ...cases.map((item) => item.name),
  ]) {
    console.info(`${name}: ${(1_000_000 / results.get(name).throughput.mean).toFixed(2)} µs/call`);
  }
});
