import { useLayoutEffect, useRef, useState } from "react";
import { displayLines, visibleLines } from "./lines";

/** Matches leading-[18px] below. The window math needs every line the same height. */
const LINE_HEIGHT = 18;
/** Longer output scrolls inside the card. */
const MAX_VISIBLE_LINES = 20;
/** Lines kept on each side of the view. */
const OVERSCAN = 20;
/** py-2 */
const PADDING_Y = 8;

/**
 * Plain text in a box that shows at most MAX_VISIBLE_LINES lines and scrolls
 * the rest. Only the lines in and near the view are on the page, so output
 * of any length costs the same to draw. Lines don't wrap. With `follow`, the view opens at
 * the end and stays there as the text grows, until you scroll up. It keeps
 * following after `follow` turns off, so the last update of a finished
 * command still shows.
 */
export function OutputView({
  text,
  follow = false,
  tone = "normal",
}: {
  text: string;
  follow?: boolean;
  tone?: "normal" | "error";
}) {
  const lines = displayLines(text);
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const followed = useRef(false);
  const viewHeight = Math.min(lines.length, MAX_VISIBLE_LINES) * LINE_HEIGHT;
  const { start, end } = visibleLines(
    scrollTop - PADDING_Y,
    viewHeight,
    LINE_HEIGHT,
    lines.length,
    OVERSCAN,
  );

  // After each render, so the view keeps up with every line that came in.
  useLayoutEffect(() => {
    if (follow) followed.current = true;
    const element = scroller.current;
    if (followed.current && element && atEnd.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      ref={scroller}
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        atEnd.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < LINE_HEIGHT;
        setScrollTop(element.scrollTop);
      }}
      style={{ height: viewHeight + 2 * PADDING_Y }}
      className={`overflow-auto px-3 py-2 font-mono text-xs leading-[18px] outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "error" ? "text-destructive" : ""
      }`}
    >
      <div
        className="relative"
        style={{ height: lines.length * LINE_HEIGHT, minWidth: `${widest}ch` }}
      >
        <pre className="absolute left-0" style={{ top: start * LINE_HEIGHT }}>
          {lines.slice(start, end).join("\n")}
        </pre>
      </div>
    </div>
  );
}
