// The command palette: type to find an action, a thread or a project, then
// press Enter. It looks like T3 Code's (apps/web/src/components/
// CommandPalette.tsx), which builds on Base UI's Autocomplete. This one sits in
// the ui Dialog and follows the ARIA combobox pattern itself.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { runPaletteAction } from "../commands";
import { useHost } from "../connection";
import { isMac } from "../platform";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
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

/**
 * App.tsx mounts the palette only while it's open. Escape, a press outside it
 * and its shortcut close it, and focus goes back to where it was.
 */
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

  useLayoutEffect(() => {
    document.getElementById(`${id}-option-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [id, current]);

  // The dialog moves focus to the search field a little after it opens. Until
  // then the composer still has focus, so characters typed right after the
  // shortcut are caught here and go to the search instead.
  useLayoutEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const field = input.current;
      if (event.target === field || event.isComposing) return;
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setQuery((typed) => typed + event.key);
      setHighlighted(0);
      field?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
    } else if (event.key === "Tab") {
      // Focus stays in the palette until it closes.
      event.preventDefault();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closePalette();
      }}
    >
      <DialogPopup
        aria-label="Command palette"
        showCloseButton={false}
        initialFocus={input}
        className="mt-[12vh] max-h-[min(30rem,76vh)] max-w-xl self-start"
      >
        <Input
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
        />
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          // Clicking an item mustn't take focus from the search field.
          onMouseDown={(event) => event.preventDefault()}
          className="min-h-0 overflow-y-auto"
        >
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matching commands, projects, or threads.
            </p>
          ) : null}
          {groupItems(items).map((group, groupIndex) => (
            <div key={group.name} role="presentation" className="not-first:mt-3">
              <div
                id={`${id}-group-${groupIndex}`}
                aria-hidden="true"
                className="px-2.5 pb-1 text-xs font-medium text-muted-foreground"
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
                    className={`flex items-center gap-3 rounded-control px-2.5 py-1.5 text-sm ${
                      index === current ? "bg-accent text-accent-foreground" : ""
                    }`}
                  >
                    <span className="min-w-0 shrink truncate">{item.label}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                    {item.shortcut ? <Kbd className="shrink-0">{item.shortcut}</Kbd> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
