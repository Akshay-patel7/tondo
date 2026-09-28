// The command palette: type to find an action, a thread or a project, then
// press Enter. It looks like T3 Code's (apps/web/src/components/
// CommandPalette.tsx), which builds on Base UI's Autocomplete. Tondo has no
// Base UI until Stage 12, so this one follows the ARIA combobox pattern itself.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { runPaletteAction } from "../commands";
import { useHost } from "../connection";
import { isMac } from "../platform";
import { SearchIcon } from "../ui/icons";
import { filterItems, paletteItems, type PaletteGroup, type PaletteItem } from "./model";
import { closePalette } from "./store";

interface Group {
  readonly name: PaletteGroup;
  readonly items: { readonly item: PaletteItem; readonly index: number }[];
}

function groupItems(items: readonly PaletteItem[]): Group[] {
  const groups: Group[] = [];
  items.forEach((item, index) => {
    const last = groups.at(-1);
    if (last?.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });
  return groups;
}

export function CommandPalette() {
  const projects = useHost((host) => host.projects);
  const open = useHost((host) => host.thread);
  const sidebarHidden = useHost((host) => host.sidebarHidden);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = filterItems(paletteItems({ projects, open, sidebarHidden, isMac }), query);
  const current = Math.min(highlighted, items.length - 1);

  // Focuses the search field, and gives focus back to where it was when the palette closes.
  useLayoutEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    document.getElementById(`${id}-option-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [id, current]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (items.length > 0) setHighlighted((current + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (item) runPaletteAction(item.action);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "Tab") {
      // Focus stays in the palette until it closes.
      event.preventDefault();
    }
  };

  return (
    <>
      <div className="app-no-drag fixed inset-0 z-40 bg-black/20" onPointerDown={closePalette} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="app-no-drag fixed top-[12vh] left-1/2 z-50 flex max-h-[420px] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-composer"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 text-muted-foreground">
          <SearchIcon />
          <input
            ref={input}
            role="combobox"
            aria-label="Search"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={items.length > 0 ? `${id}-option-${current}` : undefined}
            placeholder="Search commands, projects, and threads…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
              list.current?.scrollTo({ top: 0 });
            }}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          // Clicking an item mustn't take focus from the search field.
          onMouseDown={(event) => event.preventDefault()}
          className="min-h-0 overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No matching commands, projects, or threads.
            </p>
          ) : null}
          {groupItems(items).map((group, groupIndex) => (
            <div key={group.name} role="presentation" className="not-first:mt-2">
              <div
                id={`${id}-group-${groupIndex}`}
                aria-hidden="true"
                className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground"
              >
                {group.name}
              </div>
              <div role="group" aria-labelledby={`${id}-group-${groupIndex}`}>
                {group.items.map(({ item, index }) => (
                  <div
                    key={item.key}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={index === current}
                    onPointerMove={() => setHighlighted(index)}
                    onClick={() => runPaletteAction(item.action)}
                    className={`flex items-center gap-3 rounded-control px-2 py-1.5 text-sm ${
                      index === current ? "bg-accent text-accent-foreground" : ""
                    }`}
                  >
                    <span className="min-w-0 shrink truncate">{item.label}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                    {item.shortcut ? (
                      <kbd className="shrink-0 font-sans text-xs text-muted-foreground">
                        {item.shortcut}
                      </kbd>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
