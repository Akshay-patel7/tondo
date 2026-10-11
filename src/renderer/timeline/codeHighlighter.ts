// Code blocks in replies are highlighted by Shiki's github-light and
// github-dark, through @streamdown/code. A few of their colors fall under
// WCAG AA's 4.5:1 on the page, so this plugin hands Streamdown each result
// with those colors swapped (syntaxColors.ts).
import { code, type CodeHighlighterPlugin, type HighlightResult } from "@streamdown/code";
import { CODE_BLOCK_DARK, CODE_BLOCK_LIGHT } from "../tools/syntaxColors";

const swapped = new WeakMap<HighlightResult, HighlightResult>();

/**
 * `result` with the colors swapped. The plugin keeps its results, so each one
 * gets one copy, and asking again gives the same object back, which keeps a
 * code block from rendering again.
 */
function withLegibleColors(result: HighlightResult): HighlightResult {
  let copy = swapped.get(result);
  if (!copy) {
    copy = {
      ...result,
      tokens: result.tokens.map((line) =>
        line.map((token) => {
          // A theme pair's light color is `color`, and its dark one --shiki-dark.
          const light = CODE_BLOCK_LIGHT[token.htmlStyle?.color?.toLowerCase() ?? ""];
          const dark = CODE_BLOCK_DARK[token.htmlStyle?.["--shiki-dark"]?.toLowerCase() ?? ""];
          if (!light && !dark) return token;
          const htmlStyle = { ...token.htmlStyle };
          if (light) htmlStyle.color = light;
          if (dark) htmlStyle["--shiki-dark"] = dark;
          return { ...token, htmlStyle };
        }),
      ),
    };
    swapped.set(result, copy);
  }
  return copy;
}

export const codeHighlighter: CodeHighlighterPlugin = {
  ...code,
  highlight: (options, callback) => {
    const result = code.highlight(
      options,
      callback && ((highlighted) => callback(withLegibleColors(highlighted))),
    );
    return result && withLegibleColors(result);
  },
};
