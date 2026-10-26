// The rail and preview interaction follow T3 Code's chat/MessagesTimeline.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useId, useState } from "react";
import { cn } from "../lib/cn";
import { navigationIndex } from "../timeline/navigation";

interface MessageNavigatorProps {
  count: number;
  current: number;
  preview: (index: number) => { prompt: string; reply: string };
  onSelect: (index: number) => void;
}

/** One focus stop and at most 40 decorative ticks, regardless of thread size. */
export function MessageNavigator({ count, current, preview, onSelect }: MessageNavigatorProps) {
  const instructions = useId();
  const previewId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const active = hovered ?? focused;
  const selected = active === null ? null : Math.min(count - 1, active);
  const text = selected === null ? null : preview(selected);
  const tickCount = Math.min(40, count);
  const marker = selected ?? current;
  const activeTick = navigationIndex(marker / Math.max(1, count - 1), tickCount);
  if (count < 2) return null;

  return (
    <nav
      aria-label="Message history"
      className="pointer-events-none absolute inset-y-0 left-1 z-10 flex w-7 items-center"
      onPointerLeave={() => setHovered(null)}
    >
      <span id={instructions} className="sr-only">
        Use Up and Down to preview messages, Home and End for the first and last. Press Enter to
        jump.
      </span>
      <div
        className="relative w-full"
        style={{ height: Math.max(32, Math.min(240, (count - 1) * 8)), maxHeight: "50%" }}
      >
        <button
          type="button"
          aria-label="Browse past messages"
          aria-describedby={text ? `${instructions} ${previewId}` : instructions}
          className="pointer-events-auto relative block h-full w-full cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHovered(navigationIndex((event.clientY - rect.top) / rect.height, count));
          }}
          onClick={(event) => {
            // Keyboard activation has no pointer coordinates.
            const rect = event.currentTarget.getBoundingClientRect();
            const index =
              event.detail === 0
                ? (selected ?? current)
                : navigationIndex((event.clientY - rect.top) / rect.height, count);
            setHovered(null);
            setFocused(null);
            onSelect(index);
          }}
          onFocus={() => setFocused(current)}
          onBlur={() => setFocused(null)}
          onKeyDown={(event) => {
            let index = selected ?? current;
            switch (event.key) {
              case "ArrowUp":
              case "ArrowLeft":
                index--;
                break;
              case "ArrowDown":
              case "ArrowRight":
                index++;
                break;
              case "Home":
                index = 0;
                break;
              case "End":
                index = count - 1;
                break;
              case "Escape":
                setHovered(null);
                setFocused(null);
                event.currentTarget.blur();
                return;
              default:
                return;
            }
            event.preventDefault();
            setHovered(null);
            setFocused(Math.max(0, Math.min(count - 1, index)));
          }}
        >
          {Array.from({ length: tickCount }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              data-history-tick
              className={cn(
                "pointer-events-none absolute left-1 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/40",
                index === activeTick ? "w-5 bg-foreground" : "w-2.5",
                Math.abs(index - activeTick) === 1 && "w-3.5",
              )}
              style={{ top: `${(index / Math.max(1, tickCount - 1)) * 100}%` }}
            />
          ))}
        </button>
        {text && selected !== null && (
          <div
            id={previewId}
            role="tooltip"
            className="pointer-events-none absolute left-9 w-72 max-w-[calc(100vw-5rem)] -translate-y-1/2 rounded-control border border-border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-composer"
            style={{ top: `${(selected / Math.max(1, count - 1)) * 100}%` }}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              Message {selected + 1} of {count}
            </p>
            <p className="line-clamp-2 break-words font-medium">{text.prompt}</p>
            <p className="mt-1 line-clamp-3 break-words text-muted-foreground">{text.reply}</p>
          </div>
        )}
      </div>
    </nav>
  );
}
