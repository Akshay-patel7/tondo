// Seeded markdown for the recorded fixtures. The same seed always gives the
// same text, so re-recording changes only the timing.

type Random = () => number;

/** mulberry32: a small, fast PRNG that is good enough for test content. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick() needs a non-empty list");
  return item;
}

function between(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

const SENTENCES = [
  "The parser reads each token once and never backtracks.",
  "That keeps the hot loop free of allocations, which matters more than the algorithm here.",
  "I checked the callers first, and only two of them depend on the old ordering.",
  "The cache is keyed by the file's content hash, so a rename doesn't invalidate it.",
  "Both paths end up in `flushPending`, which is where the duplicate write came from.",
  "Moving the check to the boundary means the inner functions can trust their input.",
  "The test only passed because the fixture happened to be sorted already.",
  "A **single** lock around the queue is simpler than the per-item locks, and just as fast at this size.",
  "Once the stream closes, the buffered text is replaced by the final message.",
  "The retry loop now gives up after three attempts instead of spinning forever.",
  "This mirrors what the CLI does, so both front ends agree on the result.",
  "Nothing else in the module reads that field, so it's safe to drop.",
  "I kept the public signature the same and changed only the internals.",
  "The benchmark moved from about 40 ms to under 5 ms on the large input.",
  "Errors now carry the file path and line, so the message says exactly what broke.",
  "You can see the effect in the timeline: the long task disappears.",
  "The worker owns the socket, and the page only ever sees parsed events.",
  "Timestamps come from the monotonic clock, because wall-clock time can jump.",
  "The old code swallowed the exception, which is why the failure looked silent.",
  "With the index in place, the lookup is a single hash probe.",
  "I left a comment explaining why the order of these two calls matters.",
  "The config loader validates every key and rejects unknown ones with a clear error.",
  "Streaming the response keeps memory flat even for very large files.",
  "See [the design note](https://example.com/notes/streaming) for the trade-offs.",
  "This is _much_ easier to test, since each step is a pure function.",
  "The flaky test waited on a timer; it now waits for the event instead.",
  "Every branch returns the same shape, so callers need no special cases.",
  "The migration runs inside one transaction, so a failure leaves nothing half done.",
  "I measured before changing anything, and the profile pointed at `JSON.parse`.",
  "Deleting the adapter removed about 300 lines and one whole layer of indirection.",
];

const HEADINGS = [
  "What was wrong",
  "The fix",
  "How the parser works now",
  "Changes to the renderer",
  "Tests",
  "Performance",
  "Error handling",
  "Migration notes",
  "Open questions",
  "Why not a rewrite",
  "The cache",
  "Edge cases",
];

const NAMES = [
  "parser",
  "lexer",
  "session",
  "buffer",
  "timeline",
  "renderer",
  "queue",
  "cache",
  "config",
  "stream",
];

function sentence(random: Random): string {
  return pick(random, SENTENCES);
}

function paragraph(random: Random): string {
  const count = between(random, 2, 5);
  return Array.from({ length: count }, () => sentence(random)).join(" ");
}

function bulletList(random: Random): string {
  const numbered = random() < 0.35;
  const count = between(random, 3, 7);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const marker = numbered ? `${index + 1}.` : "-";
    lines.push(`${marker} ${sentence(random)}`);
    if (!numbered && random() < 0.2) lines.push(`  - ${sentence(random)}`);
  }
  return lines.join("\n");
}

function table(random: Random): string {
  const columns = pick(random, [
    ["File", "Lines", "Change"],
    ["Case", "Before", "After", "Notes"],
    ["Step", "Time (ms)", "Allocations", "Result"],
    ["Option", "Default", "Description"],
  ]);
  const rowCount = between(random, 3, 8);
  const rows: string[] = [`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`];
  for (let row = 0; row < rowCount; row++) {
    const cells = columns.map((_, column) =>
      column === 0
        ? `\`${pick(random, NAMES)}.ts\``
        : random() < 0.5
          ? String(between(random, 1, 900))
          : pick(random, ["added", "removed", "faster", "unchanged", "fixed", "renamed"]),
    );
    rows.push(`| ${cells.join(" | ")} |`);
  }
  return rows.join("\n");
}

function typescriptBlock(random: Random): string {
  const name = pick(random, NAMES);
  const Type = name.charAt(0).toUpperCase() + name.slice(1);
  const lines = [
    `export interface ${Type}Options {`,
    `  readonly limit: number;`,
    `  readonly onFlush?: (items: readonly string[]) => void;`,
    `}`,
    ``,
    `export function create${Type}(options: ${Type}Options) {`,
    `  const pending: string[] = [];`,
  ];
  const steps = between(random, 2, 12);
  for (let step = 0; step < steps; step++) {
    lines.push(`  // Step ${step + 1}: ${sentence(random).replaceAll("`", "")}`);
    lines.push(`  const value${step} = pending.length * ${between(random, 2, 64)} + ${step};`);
  }
  lines.push(
    `  return {`,
    `    push(item: string) {`,
    `      pending.push(item);`,
    `      if (pending.length >= options.limit) options.onFlush?.(pending.splice(0));`,
    `    },`,
    `  };`,
    `}`,
  );
  return "```ts\n" + lines.join("\n") + "\n```";
}

function pythonBlock(random: Random): string {
  const name = pick(random, NAMES);
  const lines = [`def load_${name}(path: str) -> list[dict]:`, `    items = []`];
  const steps = between(random, 2, 10);
  for (let step = 0; step < steps; step++) {
    lines.push(`    # ${sentence(random).replaceAll("`", "")}`);
    lines.push(`    items.append({"id": ${step}, "weight": ${between(random, 1, 99)} / 100})`);
  }
  lines.push(`    return sorted(items, key=lambda item: item["weight"])`);
  return "```python\n" + lines.join("\n") + "\n```";
}

function rustBlock(random: Random): string {
  const name = pick(random, NAMES);
  const lines = [`pub fn ${name}_len(input: &[u8]) -> usize {`, `    let mut total = 0;`];
  const steps = between(random, 2, 8);
  for (let step = 0; step < steps; step++) {
    lines.push(`    total += input.iter().filter(|b| **b == b'${"abcdef"[step % 6]}').count();`);
  }
  lines.push(`    total`, `}`);
  return "```rust\n" + lines.join("\n") + "\n```";
}

function shellBlock(random: Random): string {
  const lines = [`set -euo pipefail`];
  const steps = between(random, 2, 6);
  for (let step = 0; step < steps; step++) {
    lines.push(
      pick(random, [
        `pnpm test -- ${pick(random, NAMES)}`,
        `git diff --stat HEAD~${between(random, 1, 5)}`,
        `rg -n "${pick(random, NAMES)}" src/`,
        `node scripts/${pick(random, NAMES)}.mts --verbose`,
      ]),
    );
  }
  return "```bash\n" + lines.join("\n") + "\n```";
}

function jsonBlock(random: Random): string {
  const entries = Array.from(
    { length: between(random, 2, 8) },
    (_, index) => `  "${pick(random, NAMES)}${index}": ${between(random, 0, 5000)}`,
  );
  return "```json\n{\n" + entries.join(",\n") + "\n}\n```";
}

function diffBlock(random: Random): string {
  const name = pick(random, NAMES);
  return [
    "```diff",
    `--- a/src/${name}.ts`,
    `+++ b/src/${name}.ts`,
    `@@ -${between(random, 1, 200)},4 +${between(random, 1, 200)},5 @@`,
    `-  const result = await load(path);`,
    `+  const result = await load(path, { signal });`,
    `+  if (signal.aborted) return;`,
    `   render(result);`,
    "```",
  ].join("\n");
}

function codeBlock(random: Random): string {
  return pick(random, [
    typescriptBlock,
    typescriptBlock,
    pythonBlock,
    rustBlock,
    shellBlock,
    jsonBlock,
    diffBlock,
  ])(random);
}

function block(random: Random): string {
  const roll = random();
  if (roll < 0.4) return paragraph(random);
  if (roll < 0.6) return codeBlock(random);
  if (roll < 0.78) return bulletList(random);
  if (roll < 0.9) return table(random);
  return `> ${sentence(random)}`;
}

/** A long reply: headed sections of prose, lists, tables and code. */
export function longReply(seed: number, targetChars: number): string {
  const random = seededRandom(seed);
  const parts: string[] = [paragraph(random)];
  let length = parts[0]?.length ?? 0;
  let section = 1;
  while (length < targetChars) {
    const heading = `## ${section}. ${pick(random, HEADINGS)}`;
    const blocks = [heading, ...Array.from({ length: between(random, 3, 7) }, () => block(random))];
    for (const text of blocks) {
      parts.push(text);
      length += text.length + 2;
    }
    section++;
  }
  return parts.join("\n\n");
}

/** A reply of roughly `targetChars` characters, without headings. */
export function shortReply(random: Random, targetChars: number): string {
  const parts: string[] = [paragraph(random)];
  let length = parts[0]?.length ?? 0;
  while (length < targetChars) {
    const text = block(random);
    parts.push(text);
    length += text.length + 2;
  }
  return parts.join("\n\n");
}

export function userPrompt(random: Random): string {
  return pick(random, [
    `Why does the ${pick(random, NAMES)} test fail on CI but not locally?`,
    `Refactor the ${pick(random, NAMES)} module so it no longer needs the global cache.`,
    `Can you explain how the ${pick(random, NAMES)} handles errors?`,
    `Add a test for the empty-input case in ${pick(random, NAMES)}.ts.`,
    `The ${pick(random, NAMES)} is slow on large files. Profile it and fix the worst part.`,
    `Rename ${pick(random, NAMES)} to something clearer and update the callers.`,
    `Summarize what changed in the last three commits.`,
  ]);
}

export function toolCommand(random: Random): string {
  const files = Array.from({ length: between(random, 2, 6) }, () => pick(random, NAMES));
  return `printf 'src/%s.ts\\n' ${files.join(" ")}`;
}

export function thinking(random: Random): string {
  return Array.from({ length: between(random, 1, 3) }, () => paragraph(random)).join("\n\n");
}
