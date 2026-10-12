// The follow behavior is adapted from T3 Code,
// apps/web/src/components/chat/MessagesTimeline.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { ArrowDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useThread } from "../thread/store";
import { Button } from "../ui/button";
import { followsAfterScroll } from "./follow";
import { RowView } from "./MessageView";
import { rowAt, streamingRowStart, timelineRows } from "./turns";

function Row({ index }: { index: number }) {
  // A row's object only changes when a message joins its turn, and only the
  // streaming row reads the streaming message, so only it re-renders while
  // pi writes. Once message_end lands, the same row holds the message.
  const row = useThread((thread) => rowAt(thread.messages, index));
  const streaming = useThread((thread) =>
    streamingRowStart(thread.messages, thread.streaming) === index ? thread.streaming : null,
  );
  // The last turn is over once pi stops working; an earlier one once a message follows it.
  const settled = useThread(
    (thread) =>
      !thread.running ||
      (rowAt(thread.messages, index)?.end ?? thread.messages.length) < thread.messages.length,
  );
  // A long path or URL breaks rather than running past a narrow transcript, which clips it.
  return (
    <div
      className={`mx-auto max-w-176 break-words ${index === 0 ? "pt-8" : "pt-6"}`}
      data-index={index}
      data-streaming={streaming === null ? undefined : true}
    >
      <RowView row={row} streaming={streaming} settled={settled} />
    </div>
  );
}

export function Timeline() {
  const messages = useThread((thread) => thread.messages);
  const streamingRow = useThread((thread) => streamingRowStart(thread.messages, thread.streaming));
  const scroller = useRef<HTMLDivElement>(null);
  const followingNow = useRef(true);
  const lastScroll = useRef(0);
  const programmedScroll = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [layout, setLayout] = useState(() => ({
    heights: new Map<number, number>(),
    viewport: 0,
    scroll: 0,
  }));
  const shown = timelineRows(messages).map((row) => row.start);
  const rows = streamingRow === messages.length ? [...shown, messages.length] : shown;
  let contentHeight = 0;
  const positions: { index: number; top: number; height: number }[] = [];
  for (const index of rows) {
    const top = contentHeight;
    const height = layout.heights.get(index) ?? 90;
    contentHeight += height;
    positions.push({ index, top, height });
  }
  const totalHeight = contentHeight + 16;
  const end = Math.max(0, totalHeight - layout.viewport);
  const top = following ? end : Math.max(0, Math.min(end, layout.scroll));
  const first = positions.findIndex((row) => row.top + row.height >= top - 200);
  const after = positions.findIndex((row) => row.top > top + layout.viewport + 200);
  // Keep a neighboring row on either side, including the prompt above a long reply.
  const visible =
    layout.viewport === 0
      ? positions.slice(-1)
      : positions.slice(
          Math.max(0, first - 1),
          after === -1 ? positions.length : Math.min(positions.length, after + 1),
        );

  // Measure only mounted rows. A size change above the row being read shifts
  // the scroll by the same amount, preserving its position in the viewport.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const elements = [...node.querySelectorAll<HTMLElement>("[data-virtual-row]")];
    const measure = () => {
      const measured = new Map(
        elements.map((element) => [
          Number(element.dataset.virtualRow),
          element.getBoundingClientRect().height,
        ]),
      );
      const viewport = node.clientHeight;
      const follow = followingNow.current;
      setLayout((previous) => {
        let changed = viewport !== previous.viewport;
        let beforeTop = 0;
        let correction = 0;
        const heights = new Map(previous.heights);
        for (const index of rows) {
          const oldHeight = previous.heights.get(index) ?? 90;
          const height = measured.get(index);
          if (height !== undefined && height !== previous.heights.get(index)) {
            heights.set(index, height);
            changed = true;
            if (!follow && beforeTop + oldHeight <= previous.scroll) {
              correction += height - oldHeight;
            }
          }
          beforeTop += oldHeight;
        }
        return changed ? { heights, viewport, scroll: previous.scroll + correction } : previous;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const element of elements) observer.observe(element);
    measure();
    return () => observer.disconnect();
  });

  // Scroll updates inside the follow band must not cancel native animations.
  // Reposition only when the target changes, not on every scroll-state render.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const desired = following ? node.scrollHeight - node.clientHeight : top;
    if (Math.abs(node.scrollTop - desired) > 0.5) {
      node.scrollTop = desired;
      programmedScroll.current = node.scrollTop;
    }
    lastScroll.current = node.scrollTop;
  }, [following, top]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    const scroll = node.scrollTop;
    if (programmedScroll.current === scroll) {
      programmedScroll.current = null;
      return;
    }
    programmedScroll.current = null;
    followingNow.current = followsAfterScroll(followingNow.current, lastScroll.current, {
      scroll,
      contentLength: node.scrollHeight,
      scrollLength: node.clientHeight,
    });
    lastScroll.current = scroll;
    setFollowing(followingNow.current);
    setLayout((previous) => (previous.scroll === scroll ? previous : { ...previous, scroll }));
  };

  const jumpToLatest = () => {
    const node = scroller.current;
    node?.focus({ preventScroll: true });
    // Stop an in-flight native PageUp before React commits the follow state.
    node?.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    followingNow.current = true;
    setFollowing(true);
  };

  return (
    <div className="relative h-full min-h-0" data-testid="timeline" data-following={following}>
      <div
        ref={scroller}
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          // Native keyboard scrolling animates through unmeasured rows.
          // Anchor corrections would interrupt it before the requested end.
          if (event.key === "Home") {
            event.preventDefault();
            followingNow.current = false;
            setFollowing(false);
            setLayout((previous) => ({ ...previous, scroll: 0 }));
          } else if (event.key === "End") {
            event.preventDefault();
            jumpToLatest();
          }
        }}
        role="region"
        aria-label="Transcript"
        tabIndex={0}
        className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-8 outline-hidden [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div
          className="relative mx-auto max-w-176 will-change-transform"
          style={{ height: totalHeight }}
        >
          {visible.map(({ index, top: rowTop }) => (
            <div
              key={index}
              data-virtual-row={index}
              className="absolute inset-x-0"
              style={{ top: rowTop }}
            >
              <Row index={index} />
            </div>
          ))}
        </div>
      </div>
      {following ? null : (
        <div className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-control border border-border bg-secondary">
          <Button variant="secondary" size="sm" onClick={jumpToLatest}>
            <ArrowDown aria-hidden />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
