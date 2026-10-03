import { createCodePlugin, type HighlightOptions, type HighlightResult } from "@streamdown/code";
import { expect, test } from "vitest";

// Exercise the installed dependency so removing its pnpm patch fails a test
// instead of silently restoring an unbounded streaming cache.
const plugin = createCodePlugin();

function options(
  code: string,
  language: HighlightOptions["language"] = "typescript",
): HighlightOptions {
  return { code, language, themes: plugin.getThemes() };
}

function highlight(input: HighlightOptions): Promise<HighlightResult> {
  return new Promise((resolve) => {
    const cached = plugin.highlight(input, resolve);
    if (cached) resolve(cached);
  });
}

function contents(result: HighlightResult): string {
  return result.tokens.map((line) => line.map((token) => token.content).join("")).join("\n");
}

test("highlighting keeps only the latest 128 results and can recompute an evicted block", async () => {
  const first = options("const evicted = 42;");
  const original = await highlight(first);
  expect(plugin.highlight(first)).toBe(original);

  for (let index = 0; index < 128; index++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- fill the cache in a known order.
    await highlight(options(`const cacheEntry${index} = ${index};`));
  }
  expect(plugin.highlight(options("const cacheEntry0 = 0;"))).not.toBeNull();
  expect(plugin.highlight(options("const cacheEntry127 = 127;"))).not.toBeNull();

  const recomputed = await new Promise<HighlightResult>((resolve) => {
    expect(plugin.highlight(first, resolve)).toBeNull();
  });
  // Shiki's 500 ms per-line limit can leave different token scopes on a cold,
  // CPU-loaded run. Check the source and theme, not its internal grammar state.
  expect(contents(recomputed)).toBe(first.code);
  expect(recomputed.fg).toBe(original.fg);
  expect(recomputed.bg).toBe(original.bg);
});

test("a shared highlighter loads different languages concurrently, including aliases", async () => {
  const inputs = [
    options("const value: number = 1;", "ts"),
    options("def greet():\n    return 'hello'", "python"),
    options("echo hello", "bash"),
    options('{"ready":true}', "json"),
  ];
  const results = await Promise.all(inputs.map(highlight));
  expect(results.map(contents)).toEqual(inputs.map((input) => input.code));
  for (const result of results) {
    expect(result.tokens.flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ htmlStyle: expect.any(Object) })]),
    );
  }
});

test("unsupported code fences fall back to plain text without loading a grammar", async () => {
  // Fences come from model output, not a validated BundledLanguage value.
  const language = "unknown-memory-test-language" as HighlightOptions["language"];
  expect(plugin.supportsLanguage(language)).toBe(false);
  const input = options("unchanged <plain> text", language);
  expect(contents(await highlight(input))).toBe(input.code);
});

test("different theme pairs keep their own styles", async () => {
  const input = options("const themed = true;");
  const [github, plus] = await Promise.all([
    highlight(input),
    highlight({ ...input, themes: ["light-plus", "dark-plus"] }),
  ]);
  expect(contents(github)).toBe(input.code);
  expect(contents(plus)).toBe(input.code);
  expect(plus.tokens).not.toEqual(github.tokens);
});
