import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";
import { SessionHistory } from "./history";

const dir = mkdtempSync(path.join(tmpdir(), "tondo-history-bench-"));
const file = path.join(dir, "history.jsonl");
const timestamp = "2026-10-26T00:00:00.000Z";
writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "bench", timestamp })}\n`);
let parentId: string | null = null;
function append(type: string, id: string, payload: object): void {
  appendFileSync(file, `${JSON.stringify({ type, id, parentId, timestamp, ...payload })}\n`);
  parentId = id;
}
append("message", "old", { message: { role: "user", content: "Old prompt", timestamp: 1 } });
for (let i = 0; i < 8; i++)
  append("message", `large-${i}`, {
    message: {
      role: "toolResult",
      toolCallId: `call-${i}`,
      toolName: "bash",
      content: [{ type: "text", text: "x".repeat(4 * 1024 * 1024) }],
      timestamp: 1,
    },
  });
for (let i = 0; i < 5000; i++)
  append("message", `small-${i}`, {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Small saved reply" }],
      timestamp: 1,
    },
  });
append("message", "live", { message: { role: "user", content: "Live prompt", timestamp: 2 } });
append("compaction", "compacted", {
  summary: "Summary",
  firstKeptEntryId: "live",
  tokensBefore: 100_000,
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("saved history indexing skips 32 MiB of old tool bodies", async ({ bench }) => {
  const history = await SessionHistory.read(file, "bench");
  const names = [
    "index 32 MiB plus 5,000 messages",
    "bounded saved preview",
    "bounded history page",
  ];
  const results = await bench.compare(
    bench(names[0]!, () => SessionHistory.read(file, "bench")),
    bench(names[1]!, () => history.preview("old")),
    bench(names[2]!, () => history.page("old")),
  );
  for (const name of names)
    console.info(`${name}: ${(1000 / results.get(name).throughput.mean).toFixed(2)} ms/call`);
});
