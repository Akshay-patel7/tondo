import { useLayoutEffect } from "react";
import type { FileIndex } from "../../shared/files";

export function fileOptionId(id: string, index: number): string {
  return `${id}-file-${index}`;
}

export function FileMenu({
  id,
  index,
  paths,
  highlighted,
  onHighlight,
  onPick,
}: {
  id: string;
  index: FileIndex | null;
  paths: readonly string[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (path: string) => void;
}) {
  useLayoutEffect(() => {
    document.getElementById(fileOptionId(id, highlighted))?.scrollIntoView({ block: "nearest" });
  }, [id, highlighted]);

  const status = index === null ? "Reading project files…" : index.error;
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Files"
      onMouseDown={(event) => event.preventDefault()}
      className="max-h-64 overflow-y-auto border-b border-border p-1.5"
    >
      {status ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{status}</p> : null}
      {index && !status && paths.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching file.</p>
      ) : null}
      {index?.truncated ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          This project has over 10,000 files. Keep typing to search all of them by name or path.
        </p>
      ) : null}
      {paths.map((path, row) => (
        <div
          key={path}
          id={fileOptionId(id, row)}
          role="option"
          aria-selected={row === highlighted}
          onPointerMove={() => onHighlight(row)}
          onClick={() => onPick(path)}
          title={path}
          className="truncate rounded-control px-2 py-1.5 font-mono text-xs aria-selected:bg-selected aria-selected:text-foreground"
        >
          {path}
        </div>
      ))}
    </div>
  );
}
