import type { IUnicodeVersionProvider } from "@xterm/xterm";

// xterm packs a character's properties as (state << 3) | (width << 1) | joins,
// as UnicodeService.createPropertyValue does. The state says what the cluster
// so far can still join with.
const OTHER = 0;
const PICTOGRAPH = 1;
const PICTOGRAPH_ZWJ = 2;
const REGIONAL = 3;

const ZWJ = 0x200d;
const VS16 = 0xfe0f;

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const EXTEND = /^[\p{Mn}\p{Me}\p{Emoji_Modifier}\u{e0020}-\u{e007f}]$/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;

// A character's class: its width in the low two bits, then these flags.
const EXTENDS = 4;
const PICTO = 8;
const RI = 16;
const UNKNOWN = 255;

const bmp = new Uint8Array(0x10000).fill(UNKNOWN);
const astral = new Map<number, number>();

/** East Asian wide ranges, as in Markus Kuhn's wcwidth that xterm's UnicodeV6 follows. */
function wide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

function classify(cp: number): number {
  const char = String.fromCodePoint(cp);
  let width: number;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) width = 0;
  else if (cp === 0xad) width = 1;
  else if (ZERO_WIDTH.test(char) || (cp >= 0x1160 && cp <= 0x11ff)) width = 0;
  else if (wide(cp) || EMOJI_PRESENTATION.test(char)) width = 2;
  else width = 1;
  let flags = 0;
  if (EXTEND.test(char) || cp === 0x200c || cp === ZWJ) flags |= EXTENDS;
  if (PICTOGRAPHIC.test(char)) flags |= PICTO;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) flags |= RI;
  return width | flags;
}

function lookup(cp: number): number {
  if (cp < 0x10000) {
    let value = bmp[cp]!;
    if (value === UNKNOWN) value = bmp[cp] = classify(cp);
    return value;
  }
  let value = astral.get(cp);
  if (value === undefined) astral.set(cp, (value = classify(cp)));
  return value;
}

function properties(state: number, width: number, joins: boolean): number {
  return (state << 3) | (width << 1) | (joins ? 1 : 0);
}

/**
 * Widths and grapheme joining for xterm, so an emoji with a skin tone, a ZWJ
 * family or a flag takes one wide cell instead of overlapping glyphs, and
 * emoji take two columns as in macOS's own wcwidth. It follows the parts of
 * Unicode's grapheme cluster rules that terminals draw: combining marks,
 * emoji modifiers and variation selectors, ZWJ sequences and flag pairs.
 */
export class GraphemeUnicode implements IUnicodeVersionProvider {
  readonly version = "tondo-graphemes";

  wcwidth(codepoint: number): 0 | 1 | 2 {
    return (lookup(codepoint) & 3) as 0 | 1 | 2;
  }

  charProperties(codepoint: number, preceding: number): number {
    // The hot path: printable ASCII neither joins nor starts an emoji cluster.
    if (codepoint >= 0x20 && codepoint < 0x7f) return properties(OTHER, 1, false);
    const value = lookup(codepoint);
    const width = value & 3;
    const before = (preceding >> 1) & 3;
    if (before > 0) {
      const state = preceding >> 3;
      if (state === REGIONAL && value & RI) return properties(OTHER, 2, true);
      if (state === PICTOGRAPH_ZWJ && value & PICTO) return properties(PICTOGRAPH, 2, true);
      if (value & EXTENDS) {
        const next =
          state === PICTOGRAPH ? (codepoint === ZWJ ? PICTOGRAPH_ZWJ : PICTOGRAPH) : OTHER;
        const joined = state === PICTOGRAPH && codepoint === VS16 ? 2 : before;
        return properties(next, Math.max(joined, width), true);
      }
    }
    const state = value & RI ? REGIONAL : value & PICTO ? PICTOGRAPH : OTHER;
    return properties(state, width, false);
  }
}
