// A menu of actions at a point on screen, for the sidebar's thread and
// project menus. Stage 12 replaces it with Base UI's.
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
}

/** Where a menu opens: its top left corner, or its top right one with `alignRight`. */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
  readonly alignRight?: boolean;
}

const EDGE = 8;

export function Menu({
  label,
  at,
  items,
  note,
  onClose,
}: {
  label: string;
  at: MenuPoint;
  items: readonly MenuItem[];
  /** Text above the items, such as what a destructive item does. */
  note?: ReactNode;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  // Keeps the menu inside the window and focuses its first item. A menu whose
  // items change, such as to confirm a step, needs a new `key` to run this again.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = at.alignRight ? at.x - width : at.x;
    element.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE))}px`;
    element.style.top = `${Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE))}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const focused = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(focused + step + buttons.length) % buttons.length]?.focus();
    }
  };

  // It renders into the body. The sidebar has its own compositing layer, and
  // the transform that gives it one would confine these fixed elements to the
  // sidebar, so the backdrop would miss clicks on the rest of the window.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={menu}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="fixed top-0 left-0 z-50 flex min-w-44 flex-col rounded-control border border-border bg-card p-1 text-sm shadow-composer"
      >
        {note ? (
          <div className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{note}</div>
        ) : null}
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={item.onSelect}
            className={`rounded-[calc(var(--control-radius)-4px)] px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent ${item.destructive ? "text-destructive" : ""}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
