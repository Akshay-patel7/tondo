// Plain-text output split into lines, and which of them a scrolled view needs.

/** A line longer than this shows cut, so one huge line can't stall layout. */
export const MAX_LINE_CHARS = 1000;

/**
 * `text` as the lines an output view shows: tabs as four spaces, as pi's own
 * terminal UI shows them, and every line cut to MAX_LINE_CHARS.
 */
export function displayLines(text: string): string[] {
  const lines = text.replace(/\n$/, "").replaceAll("\t", "    ").split("\n");
  return lines.map((line) =>
    line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line,
  );
}

/** The lines from `start` up to, not including, `end`. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The lines a view scrolled to `scrollTop` shows, plus `overscan` lines on
 * each side, so a small scroll doesn't wait a frame for new lines.
 */
export function visibleLines(
  scrollTop: number,
  viewHeight: number,
  lineHeight: number,
  lineCount: number,
  overscan: number,
): LineRange {
  const first = Math.floor(Math.max(0, scrollTop) / lineHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + viewHeight) / lineHeight);
  return {
    start: Math.max(0, Math.min(first - overscan, lineCount)),
    end: Math.max(0, Math.min(last + overscan, lineCount)),
  };
}
