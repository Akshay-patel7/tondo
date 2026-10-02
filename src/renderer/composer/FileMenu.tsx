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
      {status ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{status}</p> : null}
      {index && !status && paths.length === 0 ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No matching file.</p>
      ) : null}
      {index?.truncated ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          Showing the first 10,000 paths in this project.
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
          className={`truncate rounded-control px-2.5 py-1 text-sm ${row === highlighted ? "bg-accent text-accent-foreground" : ""}`}
        >
          {path}
        </div>
      ))}
    </div>
  );
}
