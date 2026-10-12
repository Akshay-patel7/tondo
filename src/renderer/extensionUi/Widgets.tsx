// What extensions show around the composer: widget lines above or below it,
// and their status entries in the row under it, as pi's terminal UI shows
// them around its editor. Over RPC both are plain text.
import type { ReactNode } from "react";
import type { WidgetPlacement } from "../../shared/protocol";
import { useExtensionUi } from "./store";

/** The widgets extensions placed above or below the composer. */
export function Widgets({ placement }: { placement: WidgetPlacement }) {
  const widgets = useExtensionUi((ui) => ui.widgets);
  const placed = widgets.filter((widget) => widget.placement === placement);
  if (placed.length === 0) return null;
  return (
    <div
      aria-label={placement === "aboveEditor" ? "Extension widgets" : "Extension widgets below"}
      className={`flex max-h-48 flex-col gap-1.5 overflow-auto rounded-control border border-border bg-muted px-4 py-2 font-mono text-xs whitespace-pre text-muted-foreground ${
        placement === "aboveEditor" ? "mb-2" : "mt-2"
      }`}
    >
      {placed.map((widget) => (
        <div key={widget.key} data-widget={widget.key}>
          {widget.lines.join("\n")}
        </div>
      ))}
    </div>
  );
}

/**
 * The row under the composer card: the extensions' status texts on the
 * left, and `end` on the right, such as the thread's Git pill or the home
 * page's project picker. As in pi's footer, the texts go in key order and
 * the keys stay hidden, because extensions use them as ids and to sort, like
 * "0-claude-max". The texts wrap before `end` does, and `end` keeps its own
 * width. Nothing renders with no texts and no `end`.
 */
export function StatusRow({ end }: { end?: ReactNode }) {
  const statuses = useExtensionUi((ui) => ui.statuses);
  if (statuses.length === 0 && !end) return null;
  const entries = statuses.toSorted((a, b) => a.key.localeCompare(b.key));
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-2 pt-2 text-xs leading-5 text-muted-foreground">
      {entries.length > 0 ? (
        <ul
          role="list"
          aria-label="Extension status"
          className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-x-3"
        >
          {entries.map((status) => (
            <li key={status.key} data-status={status.key}>
              {status.text}
            </li>
          ))}
        </ul>
      ) : null}
      {end}
    </div>
  );
}
