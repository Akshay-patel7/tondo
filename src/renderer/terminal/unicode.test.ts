import { describe, expect, it } from "vitest";
import { GraphemeUnicode } from "./unicode";

const unicode = new GraphemeUnicode();

/** Cells and clusters as xterm's InputHandler.print lays out `text`. */
function layout(text: string): { cells: number; clusters: string[] } {
  let cells = 0;
  let preceding = 0;
  const clusters: string[] = [];
  for (const char of text) {
    const value = unicode.charProperties(char.codePointAt(0)!, preceding);
    const width = (value >> 1) & 3;
    if (value & 1) {
      cells += width - ((preceding >> 1) & 3);
      clusters[clusters.length - 1] += char;
    } else {
      cells += width;
      clusters.push(char);
    }
    preceding = value;
  }
  return { cells, clusters };
}

describe("terminal grapheme widths", () => {
  it.each([
    ["👍🏽", 2],
    ["👨‍👩‍👧", 2],
    ["❤️", 2],
    ["🇯🇵", 2],
    ["🏴󠁧󠁢󠁳󠁣󠁴󠁿", 2],
  ])("draws %s as one wide cluster", (text, cells) => {
    expect(layout(text)).toEqual({ cells, clusters: [text] });
  });

  it("keeps separate emoji, flags and text apart", () => {
    expect(layout("👍🏽👨‍👩‍👧x").clusters).toEqual(["👍🏽", "👨‍👩‍👧", "x"]);
    expect(layout("🇯🇵🇫🇷").clusters).toEqual(["🇯🇵", "🇫🇷"]);
    expect(layout("a\u200db").clusters).toEqual(["a\u200d", "b"]);
  });

  it("keeps CJK wide, combining marks joined and ASCII narrow", () => {
    expect(layout("漢字한글")).toEqual({ cells: 8, clusters: ["漢", "字", "한", "글"] });
    expect(layout("e\u0301")).toEqual({ cells: 1, clusters: ["e\u0301"] });
    expect(layout("abc é")).toEqual({ cells: 5, clusters: ["a", "b", "c", " ", "é"] });
    expect(unicode.wcwidth(0x07)).toBe(0);
    expect(unicode.wcwidth(0x200b)).toBe(0);
  });
});
