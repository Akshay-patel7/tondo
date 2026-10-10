// The list setup is adapted from T3 Code,
// apps/web/src/components/chat/MessagesTimeline.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type MaintainScrollAtEndOptions,
} from "@legendapp/list/react";
import { ArrowDown } from "lucide-react";
import { useRef, useState } from "react";
import { useThread } from "../thread/store";
import { timelineRows } from "../tools/model";
import { Button } from "../ui/button";
import { followsAfterScroll } from "./follow";
import { MessageView } from "./MessageView";

/**
 * A row is the index of the message it shows. The row after the last message
 * shows the message pi is writing, which lands at that index when it ends.
 */
type TimelineRow = number;

/**
 * Follow the end only for new rows and growing rows. Scrolling to the end
 * without animation keeps up with a reply that grows every frame.
 */
const FOLLOW: MaintainScrollAtEndOptions = {
  animated: false,
  on: { dataChange: true, footerLayout: false, itemLayout: true, layout: true },
};
const KEEP_POSITION = { data: true, size: true };

// Messages are only ever appended, so a message's index is a stable key. It
// also lets the finished message take over the streaming row instead of
// remounting it.
const keyByMessage = (row: TimelineRow) => String(row);
const renderRow = ({ item }: LegendListRenderItemProps<TimelineRow>) => <Row index={item} />;

function Row({ index }: { index: number }) {
  // Only the streaming row reads the streaming message, so only it re-renders
  // while pi writes. Once message_end lands, the same index holds the message.
  const message = useThread((thread) => thread.messages[index] ?? thread.streaming);
  const streaming = useThread(
    (thread) => index >= thread.messages.length && thread.streaming !== null,
  );
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
  const opened = useRef(false);
  const [following, setFollowing] = useState(true);
  const lastScroll = useRef(0);
  const shown = timelineRows(messages);
  const rows: readonly TimelineRow[] = streaming ? [...shown, messages.length] : shown;
  const rowType = (row: TimelineRow) => messages[row]?.role ?? "assistant";

  const onScroll = () => {
    const state = listRef.current?.getState();
    if (!state) return;
    const previousScroll = lastScroll.current;
    lastScroll.current = state.scroll;
    setFollowing((wasFollowing) => followsAfterScroll(wasFollowing, previousScroll, state));
  };

  // Legend List hides the rows until its opening scroll to the end finishes.
  // That scroll can't finish while the last row grows, so a thread opened
  // mid-reply stays blank until a fallback timer ends it, 150 to 170 ms in.
  // It also stays alive for 2 s, and a new row in that window restarts it with
  // visible-position upkeep off: the rows above move by their size estimates'
  // error, about 325,000 px in the 1,000-message fixture, for a frame. Any
  // imperative scroll ends it for good. Ending it while the view is still far
  // from the end shows the rows there for a frame, so wait until the view is
  // within a screen of the end, or until Legend List finishes it.
  const endOpeningScroll = () => {
    if (opened.current) return;
    opened.current = true;
    void listRef.current?.scrollToEnd({ animated: false });
  };
  const onItemSizeChanged = () => {
    if (opened.current) return;
    const state = listRef.current?.getState();
    if (state && state.contentLength - state.scroll - state.scrollLength <= state.scrollLength) {
      endOpeningScroll();
    }
  };

  // The button goes away once the list follows again, so keyboard focus moves
  // to the transcript first. Following starts before the scroll, so the view
  // stays at the end when rows there measure taller than their estimates.
  const jumpToLatest = () => {
    const list = listRef.current;
    if (!list) return;
    list.getScrollableNode().focus({ preventScroll: true });
    setFollowing(true);
    void list.scrollToEnd({ animated: false });
  };

  return (
    <div className="relative h-full min-h-0" data-testid="timeline" data-following={following}>
      {/* The focus ring is inset, like ScrollArea's: outside the list it would
          run under the header and the composer. */}
      <LegendList<TimelineRow>
        ref={listRef}
        data={rows}
        keyExtractor={keyByMessage}
        getItemType={rowType}
        renderItem={renderRow}
        estimatedItemSize={90}
        initialScrollAtEnd
        maintainScrollAtEnd={following ? FOLLOW : false}
        maintainScrollAtEndThreshold={1}
        maintainVisibleContentPosition={KEEP_POSITION}
        onScroll={onScroll}
        onItemSizeChanged={onItemSizeChanged}
        onReady={endOpeningScroll}
        role="region"
        aria-label="Transcript"
        tabIndex={0}
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain px-4 outline-hidden [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      {following ? null : (
        // The border sets the button off from the rows it floats over. The
        // fill covers the button's transparent border, which the rows would
        // show through.
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
