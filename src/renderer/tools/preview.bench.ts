import { test } from "vitest";
import { summarizeCall, type ToolCall } from "./model";
import { callPreview } from "./preview";

// Allocate outside the timed work. Real RPC results arrive as already-parsed strings.
const cases = [4_096, 8 * 1_024 * 1_024].map((size) => {
  const text = "output line\n".repeat(Math.ceil(size / 12)).slice(0, size);
  const call: ToolCall = {
    type: "toolCall",
    id: "bench",
    name: "bash",
    arguments: { command: text },
  };
  return {
    name: `summary and preview, ${size / 1_024} KiB input and output`,
    call,
    output: { content: [{ type: "text" as const, text }] },
  };
});

test("collapsed tool summaries and previews stay bounded as payloads grow", async ({ bench }) => {
  const results = await bench.compare(
    ...cases.map(({ name, call, output }) =>
      bench(name, () => {
        summarizeCall(call);
        callPreview({ call, status: "done", output, patch: undefined });
      }),
    ),
  );
  for (const { name } of cases) {
    const microseconds = 1_000_000 / results.get(name).throughput.mean;
    console.info(`${name}: ${microseconds.toFixed(2)} µs/call`);
  }
});
