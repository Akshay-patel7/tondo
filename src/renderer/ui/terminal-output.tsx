import type { ComponentProps } from "react";

/** Plain, selectable terminal text. Never interpret it as Markdown or HTML. */
export function TerminalOutput(props: ComponentProps<"pre">) {
  return (
    <pre
      tabIndex={0}
      className="max-h-[50vh] min-h-32 overflow-auto rounded-control border border-border bg-subtle p-3 font-mono text-xs whitespace-pre-wrap break-words select-text"
      {...props}
    />
  );
}
