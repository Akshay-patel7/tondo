// What extensions show around the composer: widget lines above or below it,
// and a status line under it, as pi's terminal UI shows them around its
// editor. Over RPC both are plain text.
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
      className={`flex max-h-48 flex-col gap-1.5 overflow-auto rounded-control border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre text-muted-foreground ${
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

/** The extensions' status texts, in one line under the composer. */
export function StatusLine() {
  const statuses = useExtensionUi((ui) => ui.statuses);
  if (statuses.length === 0) return null;
  const text = statuses.map((status) => status.text).join(" · ");
  return (
    <p
      aria-label="Extension status"
      title={text}
      className="mt-1.5 truncate px-4 text-xs text-muted-foreground"
    >
      {text}
    </p>
  );
}
