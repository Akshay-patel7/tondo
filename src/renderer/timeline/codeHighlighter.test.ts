import type { HighlightOptions, HighlightResult } from "@streamdown/code";
import { expect, test } from "vitest";
import { CODE_BLOCK_DARK, CODE_BLOCK_LIGHT } from "../tools/syntaxColors";
import { codeHighlighter } from "./codeHighlighter";

function highlight(input: HighlightOptions): Promise<HighlightResult> {
  return new Promise((resolve) => {
    const cached = codeHighlighter.highlight(input, resolve);
    if (cached) resolve(cached);
  });
}

test("code blocks get legible keyword and comment colors, and keep the rest", async () => {
  const input: HighlightOptions = {
    code: "// the sum\nreturn total;",
    language: "typescript",
    themes: codeHighlighter.getThemes(),
  };
  const result = await highlight(input);
  const tokens = result.tokens.flat();
  const keyword = tokens.find((token) => token.content === "return");
  const comment = tokens.find((token) => token.content.includes("the sum"));

  // github-light's keyword red and github-dark's comment gray.
  expect(keyword?.htmlStyle?.color).toBe(CODE_BLOCK_LIGHT["#d73a49"]);
  expect(comment?.htmlStyle?.["--shiki-dark"]).toBe(CODE_BLOCK_DARK["#6a737d"]);
  expect(keyword?.htmlStyle?.["--shiki-dark"]?.toLowerCase()).toBe("#f97583");
  // Asked again, the plugin gives back the same object, so the block doesn't render again.
  expect(codeHighlighter.highlight(input)).toBe(result);
});
