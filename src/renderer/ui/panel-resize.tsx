// Pointer capture follows ThreadTerminalDrawer.tsx in T3 Code at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useRef } from "react";

interface PanelResizeProps {
  label: string;
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  disabled: boolean;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onCancel: () => void;
}

/** A captured pointer drag or keyboard-operated vertical separator. */
export function PanelResizeHandle({
  label,
  edge,
  width,
  min,
  max,
  defaultWidth,
  disabled,
  onChange,
  onCommit,
  onCancel,
}: PanelResizeProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number; value: number } | null>(null);
  const direction = edge === "right" ? 1 : -1;
  const clamp = (value: number) => Math.max(min, Math.min(Math.round(value), max));
  const reset = () => {
    if (disabled) return;
    onChange(defaultWidth);
    onCommit(defaultWidth);
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title="Drag to resize. Arrow keys adjust width. Double-click or Enter to reset."
      className={`app-no-drag group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none select-none will-change-transform focus-visible:focus-ring ${edge === "right" ? "-right-1" : "-left-1"}`}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        if (disabled || event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          const pointerId = drag.current.pointerId;
          drag.current = null;
          onCancel();
          event.currentTarget.releasePointerCapture(pointerId);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          reset();
          return;
        }
        let next: number;
        if (event.key === "Home") next = min;
        else if (event.key === "End") next = max;
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
          next =
            width + (event.key === "ArrowRight" ? 1 : -1) * direction * (event.shiftKey ? 64 : 16);
        else return;
        event.preventDefault();
        onChange(clamp(next));
        onCommit(clamp(next));
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width, value: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (disabled || !start || start.pointerId !== event.pointerId) return;
        start.value = clamp(start.width + direction * (event.clientX - start.x));
        onChange(start.value);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        drag.current = null;
        if (!disabled && start.value !== start.width) onCommit(start.value);
        else onCancel();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        onCancel();
      }}
      onPointerCancel={() => {
        drag.current = null;
        onCancel();
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px bg-primary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </div>
  );
}
