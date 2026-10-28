import { useRef, type CSSProperties, type ReactNode } from "react";
import type { TerminalSplit } from "../../shared/terminal";

export function TerminalPane({
  id,
  label,
  active,
  divided,
  style,
  onSelect,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  divided: boolean;
  style: CSSProperties;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-terminal-id={id}
      data-active={active}
      className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden ${divided ? "border border-border data-[active=true]:border-primary" : ""}`}
      style={style}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
    >
      {divided ? (
        <div className="shrink-0 truncate px-2 pt-1 text-2xs text-muted-foreground">{label}</div>
      ) : null}
      {children}
    </div>
  );
}

/** Coordinates and ratios belong to the layout; this component owns the handle's appearance. */
export function TerminalDivider({
  direction,
  ratio,
  extent,
  style,
  onChange,
}: {
  direction: TerminalSplit["direction"];
  ratio: number;
  extent: number;
  style: CSSProperties;
  onChange: (ratio: number) => void;
}) {
  const drag = useRef<{ start: number; ratio: number; size: number } | null>(null);
  const vertical = direction === "vertical";
  const reset = () => onChange(0.5);
  return (
    <div
      role="separator"
      aria-label="Resize terminal panes"
      aria-orientation={direction}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title="Drag to resize. Arrow keys adjust. Enter or double-click resets."
      className={`absolute z-10 touch-none select-none hover:bg-primary/30 focus-visible:focus-ring ${vertical ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"}`}
      style={style}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        const decrease = vertical ? "ArrowLeft" : "ArrowUp";
        const increase = vertical ? "ArrowRight" : "ArrowDown";
        if (event.key !== decrease && event.key !== increase && event.key !== "Enter") return;
        event.preventDefault();
        if (event.key === "Enter") reset();
        else onChange(ratio + (event.key === increase ? 0.05 : -0.05));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = {
          start: vertical ? event.clientX : event.clientY,
          ratio,
          size: ((vertical ? bounds.width : bounds.height) * extent) / 100,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start && start.size > 0)
          onChange(
            start.ratio + ((vertical ? event.clientX : event.clientY) - start.start) / start.size,
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
