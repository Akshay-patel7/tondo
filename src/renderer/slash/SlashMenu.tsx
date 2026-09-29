// The slash menu over the composer's text, laid out like T3 Code's command
// menu (apps/web/src/components/chat/ComposerCommandMenu.tsx): the name, then
// what it does, then where it comes from. Focus stays in the composer, which
// moves the highlight, so the menu follows the ARIA listbox pattern with
// aria-activedescendant.
import { useLayoutEffect } from "react";
import type { SlashItem } from "./menu";

const SOURCES: Record<SlashItem["source"], string> = {
  tondo: "Tondo",
  extension: "Extension",
  prompt: "Prompt",
  skill: "Skill",
};

/** The id of the option at `index`, for the composer's aria-activedescendant. */
export function slashOptionId(menuId: string, index: number): string {
  return `${menuId}-${index}`;
}

export function SlashMenu({
  id,
  items,
  highlighted,
  onHighlight,
  onPick,
}: {
  id: string;
  items: readonly SlashItem[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (item: SlashItem) => void;
}) {
  useLayoutEffect(() => {
    document.getElementById(slashOptionId(id, highlighted))?.scrollIntoView({ block: "nearest" });
  }, [id, highlighted]);

  return (
    <div
      id={id}
      role="listbox"
      aria-label="Commands"
      // Clicking an item mustn't take focus from the composer.
      onMouseDown={(event) => event.preventDefault()}
      className="max-h-64 overflow-y-auto border-b border-border p-1.5"
    >
      {items.length === 0 ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No matching command.</p>
      ) : null}
      {items.map((item, index) => (
        <div
          key={`${item.source}:${item.name}`}
          id={slashOptionId(id, index)}
          role="option"
          aria-selected={index === highlighted}
          aria-disabled={item.unavailable === undefined ? undefined : true}
          data-source={item.source}
          onPointerMove={() => onHighlight(index)}
          onClick={() => onPick(item)}
          className={`flex items-center gap-3 rounded-control px-2.5 py-1 text-sm ${
            index === highlighted ? "bg-accent text-accent-foreground" : ""
          } ${item.unavailable === undefined ? "" : "opacity-55"}`}
        >
          <span className="max-w-[45%] shrink-0 truncate">
            <span className="font-medium">/{item.name}</span>
            {item.argument ? <span className="text-muted-foreground"> {item.argument}</span> : null}
          </span>
          <span
            title={item.unavailable ?? item.description}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {item.unavailable ?? item.description}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {item.unavailable === undefined ? SOURCES[item.source] : "Not in Tondo yet"}
          </span>
        </div>
      ))}
    </div>
  );
}
