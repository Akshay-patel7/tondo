import { describe, expect, test } from "vitest";
import { CODE_BLOCK_DARK, CODE_BLOCK_LIGHT, DIFF_DARK, DIFF_LIGHT } from "./syntaxColors";

/** WCAG 2's relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// A diff line's backgrounds as the page paints them, in sRGB: --sidebar, then
// --addition and --deletion at 11% over it (the tokens' line tints), then
// changed words at 8% more in light and 20% more in dark (code.tsx).
const DIFF_LIGHT_BACKGROUNDS = ["#f7f4ef", "#dfe7dc", "#f2deda", "#cfdecf", "#efd0cc"];
const DIFF_DARK_BACKGROUNDS = ["#0d0c0b", "#162017", "#261715", "#26412b", "#4f2925"];

// --background in index.css, in sRGB.
const PAGE_LIGHT = "#fbfaf6";
const PAGE_DARK = "#11100f";

function failures(colors: Readonly<Record<string, string>>, backgrounds: string[]): string[] {
  return Object.values(colors).flatMap((color) =>
    backgrounds
      .filter((background) => contrast(color, background) < 4.5)
      .map((background) => `${color} on ${background}: ${contrast(color, background).toFixed(2)}`),
  );
}

describe("syntax colors reach WCAG AA's 4.5:1", () => {
  test("the WCAG ratio matches known pairs", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    // The QA measured github-light's keyword red at 4.38:1 on the page.
    expect(contrast("#d73a49", PAGE_LIGHT)).toBeCloseTo(4.38, 2);
  });

  test("in diffs, on every line background", () => {
    expect(failures(DIFF_LIGHT, DIFF_LIGHT_BACKGROUNDS)).toEqual([]);
    expect(failures(DIFF_DARK, DIFF_DARK_BACKGROUNDS)).toEqual([]);
  });

  test("in code blocks, on the page", () => {
    expect(failures(CODE_BLOCK_LIGHT, [PAGE_LIGHT])).toEqual([]);
    expect(failures({ changed: CODE_BLOCK_LIGHT["#e36209"]! }, ["#ffebda"])).toEqual([]);
    expect(failures(CODE_BLOCK_DARK, [PAGE_DARK])).toEqual([]);
  });

  test("every key is a lowercase color, as Shiki looks it up", () => {
    const keys = [DIFF_LIGHT, DIFF_DARK, CODE_BLOCK_LIGHT, CODE_BLOCK_DARK].flatMap(Object.keys);
    expect(keys.filter((key) => !/^#[0-9a-f]{6}$/.test(key))).toEqual([]);
  });
});
