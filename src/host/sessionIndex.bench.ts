import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { SessionIndex } from "./sessionIndex";

const SESSIONS = 500;
/** Messages in each session, taking turns between you and pi. */
const MESSAGES = 20;
const project = "/work/app";
const folder = { dir: mkdtempSync(path.join(tmpdir(), "tondo-index-bench-")), shared: false };

afterAll(() => rmSync(folder.dir, { recursive: true, force: true }));

/** Writes session `index`: MESSAGES messages, about 23 KB. */
function writeSession(index: number): void {
  const start = Date.UTC(2026, 8, 1) + index * 60_000;
  const entries: unknown[] = [
    {
      type: "session",
      version: 3,
      id: `session-${index}`,
      timestamp: new Date(start).toISOString(),
      cwd: project,
    },
  ];
  for (let turn = 0; turn < MESSAGES; turn++) {
    const role = turn % 2 === 0 ? "user" : "assistant";
    const words = "the parser drops the last token of a line ".repeat(role === "user" ? 5 : 40);
    const timestamp = start + turn;
    entries.push({
      type: "message",
      id: `${index}-${turn}`,
      parentId: turn === 0 ? null : `${index}-${turn - 1}`,
      timestamp: new Date(timestamp).toISOString(),
      message: { role, content: [{ type: "text", text: `${turn}: ${words}` }], timestamp },
    });
  }
  const file = path.join(folder.dir, `session-${String(index).padStart(3, "0")}.jsonl`);
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

for (let index = 0; index < SESSIONS; index++) writeSession(index);

test("listing a project's sessions", async ({ bench }) => {
  const read = `${SESSIONS} sessions read for the first time`;
  const listed = `${SESSIONS} unchanged sessions listed again`;
  const warm = new SessionIndex();
  expect(await warm.list(project, folder)).toHaveLength(SESSIONS);

  const results = await bench.compare(
    bench(read, async () => {
      await new SessionIndex().list(project, folder);
    }),
    bench(listed, async () => {
      await warm.list(project, folder);
    }),
  );

  const readMs = results.get(read).latency.p50;
  const listedMs = results.get(listed).latency.p50;
  console.info(`${read}: ${readMs.toFixed(1)} ms`);
  console.info(`${listed}: ${listedMs.toFixed(1)} ms`);
  // Adding a project, or starting Tondo, lists every session it has.
  expect(readMs).toBeLessThan(1000);
  // Tondo lists every project again each time its window comes to the front.
  expect(listedMs).toBeLessThan(50);
});
