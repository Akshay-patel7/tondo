import { lazy, Suspense, useEffect, useState } from "react";
import { create } from "zustand";
import type { CheckpointFile, CheckpointTurn } from "../../shared/checkpoints";
import { listCheckpoints, readCheckpoint, useCheckpoints, useHost } from "../connection";

export const useDiffPanel = create<boolean>(() => false);
export function toggleDiffPanel(): void {
  useDiffPanel.setState(!useDiffPanel.getState(), true);
}

const DiffView = lazy(() => import("../tools/code").then((code) => ({ default: code.DiffView })));

export function DiffPanel() {
  const threadId = useHost((host) => host.thread?.id);
  const connection = useHost((host) => host.connection);
  const turns = useCheckpoints((state) => state.turns);
  const shared = useCheckpoints((state) => state.shared);
  const [chosen, setChosen] = useState<number | null>(null);
  const turn = chosen === null ? turns.at(-1) : turns.find((item) => item.turn === chosen);

  useEffect(() => {
    if (threadId && connection === "connected") listCheckpoints();
  }, [threadId, connection]);
  useEffect(() => {
    if (turn?.state === "ready" && connection === "connected") readCheckpoint(turn.turn);
  }, [turn?.turn, turn?.state, connection]);

  return (
    <aside
      aria-label="Turn changes"
      className="flex w-[420px] min-w-0 shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">Turn changes</h2>
        <button
          type="button"
          onClick={toggleDiffPanel}
          className="rounded-control px-2 py-1 text-xs hover:bg-accent"
        >
          Close changes
        </button>
      </div>
      <div className="space-y-2 border-b border-border p-3 text-xs text-muted-foreground">
        <p>Each turn includes steering and follow-ups until pi becomes idle.</p>
        <p>
          {shared
            ? "Other open threads share this folder. Their edits can appear here."
            : "Checkpoints cover the whole checkout, including edits made outside this thread."}
        </p>
        <label className="flex items-center gap-2">
          Turn
          <select
            aria-label="Checkpoint turn"
            value={chosen ?? "latest"}
            onChange={(event) =>
              setChosen(event.target.value === "latest" ? null : Number(event.target.value))
            }
            className="min-w-0 flex-1 rounded-control border border-border bg-background p-1 text-foreground"
          >
            <option value="latest">Latest turn</option>
            {turns.map((item) => (
              <option key={item.turn} value={item.turn}>
                Turn {item.turn}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <TurnDiff turn={turn} />
      </div>
    </aside>
  );
}

function TurnDiff({ turn }: { turn: CheckpointTurn | undefined }) {
  const resultTurn = useCheckpoints((state) => state.turn);
  const diff = useCheckpoints((state) => state.diff);
  const unavailable = useCheckpoints((state) => state.unavailable);
  const preparing = useHost((host) => host.thread?.preparing ?? false);
  if (!turn && preparing)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Preparing turn checkpoint…
      </p>
    );
  if (!turn)
    return (
      <p className="text-sm text-muted-foreground">
        {unavailable ?? "No turn checkpoints yet. Send a prompt to record file changes."}
      </p>
    );
  if (turn.state === "running" || turn.state === "capturing")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {turn.state === "running"
          ? `Turn ${turn.turn} is running.`
          : `Capturing turn ${turn.turn}…`}
      </p>
    );
  if (turn.state === "unavailable")
    return <p className="text-sm text-muted-foreground">{turn.reason}</p>;
  if (resultTurn !== turn.turn || diff === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading changes…
      </p>
    );
  if (diff.error !== null)
    return (
      <p role="alert" className="text-sm text-destructive">
        {diff.error}
      </p>
    );
  return <Files key={turn.turn} files={diff.files} />;
}

function Files({ files }: { files: readonly CheckpointFile[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const file = files.find((item) => item.path === selected) ?? files[0];
  if (!file) return <p className="text-sm text-muted-foreground">No file changes in this turn.</p>;
  const matching = files.filter((item) => item.path.toLowerCase().includes(filter.toLowerCase()));
  const listed = matching.slice(0, 200);
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium">Changed files ({files.length})</h3>
      <input
        aria-label="Filter changed files"
        placeholder="Filter files…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
      />
      <nav aria-label="Changed files" className="max-h-52 overflow-auto text-xs">
        <FileTree files={listed} prefix="" selected={file.path} onSelect={setSelected} />
      </nav>
      {matching.length > listed.length ? (
        <p className="text-xs text-muted-foreground">
          Showing 200 of {matching.length} matches. Filter by path to find a file.
        </p>
      ) : null}
      <h3 className="break-all font-mono text-xs">
        {file.previousPath ? `${file.previousPath} → ` : ""}
        {file.path}
      </h3>
      <FilePatch file={file} />
    </div>
  );
}

function FilePatch({ file }: { file: CheckpointFile }) {
  if (file.binary)
    return <p className="text-sm text-muted-foreground">Binary file changed. No text preview.</p>;
  if (!/^@@ /m.test(file.patch))
    return <p className="text-sm text-muted-foreground">File metadata changed. No text changes.</p>;
  return (
    <Suspense
      fallback={
        <p role="status" className="text-xs text-muted-foreground">
          Loading diff…
        </p>
      }
    >
      <DiffView patch={file.patch} />
    </Suspense>
  );
}

/** Native disclosure controls keep folders keyboard-operable without a custom tree widget. */
function FileTree({
  files,
  prefix,
  selected,
  onSelect,
}: {
  files: readonly CheckpointFile[];
  prefix: string;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const folders = [
    ...new Set(
      files
        .map((file) => file.path.slice(prefix.length))
        .filter((name) => name.includes("/"))
        .map((name) => name.slice(0, name.indexOf("/"))),
    ),
  ];
  const leaves = files.filter((file) => !file.path.slice(prefix.length).includes("/"));
  return (
    <ul className="space-y-0.5">
      {folders.map((folder) => {
        const childPrefix = `${prefix}${folder}/`;
        return (
          <li key={childPrefix}>
            <details open>
              <summary className="cursor-pointer py-1 font-mono">{folder}/</summary>
              <div className="pl-3">
                <FileTree
                  files={files.filter((file) => file.path.startsWith(childPrefix))}
                  prefix={childPrefix}
                  selected={selected}
                  onSelect={onSelect}
                />
              </div>
            </details>
          </li>
        );
      })}
      {leaves.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            aria-label={`Show diff for ${file.path}`}
            aria-pressed={selected === file.path}
            onClick={() => onSelect(file.path)}
            className={`flex w-full items-center gap-2 rounded-control px-2 py-1 text-left hover:bg-accent ${selected === file.path ? "bg-accent" : ""}`}
          >
            <span className="text-muted-foreground">{file.status}</span>
            <span className="truncate font-mono" title={file.path}>
              {file.path.slice(prefix.length)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
