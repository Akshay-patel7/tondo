// The list setup is adapted from T3 Code,
// apps/web/src/components/chat/MessagesTimeline.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type MaintainScrollAtEndOptions,
} from "@legendapp/list/react";
import { useRef, useState } from "react";
import type { PiMessage } from "../../shared/thread";
import { useThread } from "../thread/store";
import { followsAfterScroll } from "./follow";
import { MessageView } from "./MessageView";

/** Stands in for the message pi is writing, at the end of the list. */
const STREAMING = "streaming";
type TimelineRow = PiMessage | typeof STREAMING;

/**
 * Follow the end only for new rows and growing rows. Scrolling to the end
 * without animation keeps up with a reply that grows every frame.
 */
const FOLLOW: MaintainScrollAtEndOptions = {
  animated: false,
  on: { dataChange: true, footerLayout: false, itemLayout: true, layout: true },
};
const KEEP_POSITION = { data: true, size: true };

// Rows are only ever appended, so an index is a stable key. It also lets the
// finished message take over the streaming row instead of remounting it.
const keyByIndex = (_row: TimelineRow, index: number) => String(index);
const rowType = (row: TimelineRow) => (row === STREAMING ? "assistant" : row.role);
const renderRow = ({ item, index }: LegendListRenderItemProps<TimelineRow>) => (
  <Row row={item} index={index} />
);

function Row({ row, index }: { row: TimelineRow; index: number }) {
  // Only the streaming row reads the streaming message, so only it re-renders
  // while pi writes. Once message_end lands, the same index holds the message.
  const live = useThread((thread) =>
    row === STREAMING ? (thread.streaming ?? thread.messages[index] ?? null) : null,
  );
  const streaming = useThread((thread) => row === STREAMING && thread.streaming !== null);
  const message = row === STREAMING ? live : row;
  return (
    <div className="mx-auto max-w-3xl" data-index={index} data-streaming={streaming || undefined}>
      {message ? <MessageView message={message} streaming={streaming} /> : null}
    </div>
  );
}

export function Timeline() {
  const messages = useThread((thread) => thread.messages);
  const streaming = useThread((thread) => thread.streaming !== null);
  const listRef = useRef<LegendListRef>(null);
  const [following, setFollowing] = useState(true);
  const lastScroll = useRef(0);
  const rows: readonly TimelineRow[] = streaming ? [...messages, STREAMING] : messages;

  const onScroll = () => {
    const state = listRef.current?.getState();
    if (!state) return;
    const previousScroll = lastScroll.current;
    lastScroll.current = state.scroll;
    setFollowing((wasFollowing) => followsAfterScroll(wasFollowing, previousScroll, state));
  };

  // Legend List keeps its opening scroll to the end alive for 2 s. A new row in
  // that window restarts it with visible-position upkeep off, and the rows above
  // move by their size estimates' error, about 325,000 px in the 1,000-message
  // fixture, for a frame. Any imperative scroll ends the opening scroll for good.
  const onReady = () => {
    void listRef.current?.scrollToEnd({ animated: false });
  };

  return (
    <div className="h-full min-h-0" data-testid="timeline" data-following={following}>
      <LegendList<TimelineRow>
        ref={listRef}
        data={rows}
        keyExtractor={keyByIndex}
        getItemType={rowType}
        renderItem={renderRow}
        estimatedItemSize={90}
        initialScrollAtEnd
        maintainScrollAtEnd={following ? FOLLOW : false}
        maintainScrollAtEndThreshold={1}
        maintainVisibleContentPosition={KEEP_POSITION}
        onScroll={onScroll}
        onReady={onReady}
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain px-4 [overflow-anchor:none]"
      />
    </div>
  );
}
