// The follow band is adapted from T3 Code,
// apps/web/src/components/chat/MessagesTimeline.logic.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.

/**
 * Within this many pixels of the end, the list follows new output. T3 found
 * that Legend List's half-viewport isNearEnd pulled readers back down.
 */
export const FOLLOW_THRESHOLD_PX = 40;

/** Where the view is, in Legend List's measurements. */
export interface ScrollPosition {
  /** How far the list is scrolled from its top. */
  readonly scroll: number;
  /** The height of all the rows. */
  readonly contentLength: number;
  /** The height of the view. */
  readonly scrollLength: number;
}

/**
 * Whether the timeline follows new output after a scroll. Coming within
 * FOLLOW_THRESHOLD_PX of the end turns following on. Only a scroll up turns it
 * off: while pi streams, the list can grow more than FOLLOW_THRESHOLD_PX past
 * the view before Legend List scrolls to the new end, so distance alone can't
 * tell growth from a reader scrolling away.
 */
export function followsAfterScroll(
  following: boolean,
  previousScroll: number,
  position: ScrollPosition,
): boolean {
  const gap = position.contentLength - position.scroll - position.scrollLength;
  if (gap <= FOLLOW_THRESHOLD_PX) return true;
  return following && position.scroll >= previousScroll;
}
