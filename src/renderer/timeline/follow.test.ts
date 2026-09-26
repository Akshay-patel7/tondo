import { describe, expect, test } from "vitest";
import { FOLLOW_THRESHOLD_PX, followsAfterScroll } from "./follow";

// A 1,000 px view over 10,000 px of rows, so the end is at scroll 9,000.
const END = 9_000;
const position = (scroll: number, contentLength = 10_000) => ({
  scroll,
  contentLength,
  scrollLength: 1_000,
});

describe("followsAfterScroll", () => {
  test("follows at the end and within the threshold of it", () => {
    expect(followsAfterScroll(false, 0, position(END))).toBe(true);
    expect(followsAfterScroll(false, 0, position(END - FOLLOW_THRESHOLD_PX))).toBe(true);
  });

  test("keeps following when the rows grow before the list scrolls to the new end", () => {
    // 300 px of new output, and the view hasn't moved yet.
    expect(followsAfterScroll(true, END, position(END, 10_300))).toBe(true);
    // A scroll toward the end that lands before the end the rows grew to.
    expect(followsAfterScroll(true, END - 10, position(END, 10_300))).toBe(true);
  });

  test("stops following when the reader scrolls up past the threshold", () => {
    expect(followsAfterScroll(true, END, position(END - FOLLOW_THRESHOLD_PX - 1))).toBe(false);
  });

  test("keeps following when a scroll up stays within the threshold", () => {
    expect(followsAfterScroll(true, END, position(END - FOLLOW_THRESHOLD_PX))).toBe(true);
  });

  test("stays off until the reader is back within the threshold", () => {
    expect(followsAfterScroll(false, 5_000, position(6_000))).toBe(false);
    expect(followsAfterScroll(false, 6_000, position(6_000, 10_300))).toBe(false);
    expect(followsAfterScroll(false, 6_000, position(END - FOLLOW_THRESHOLD_PX))).toBe(true);
  });
});
