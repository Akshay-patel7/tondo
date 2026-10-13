import { ChevronRight, CircleAlert, FileDiff, Info, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { CheckpointFile, CheckpointTurn } from "../../shared/checkpoints";
import { readCheckpoint, useCheckpoints, useHost, usePiUpdates } from "../connection";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { FilterInput } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { useDiffPanel, useDiffTurn } from "./store";

export { toggleDiffPanel, useDiffPanel } from "./store";

const DiffView = lazy(() => import("../tools/code").then((code) => ({ default: code.DiffView })));

const LATEST = "latest";

// A chosen turn belongs to its thread. Another thread starts on its latest
// turn, whether the panel is open at the time or not.
useHost.subscribe((host, previous) => {
  if (host.thread?.id !== previous.thread?.id) useDiffTurn.setState(null, true);
});

const STATUS_NAMES: Record<string, string> = {
  A: "Added",
  C: "Copied",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
  T: "Type changed",
  U: "Unmerged",
};

const STATUS_COLORS: Record<string, string> = {
  A: "text-addition",
  D: "text-deletion",
  M: "text-warning-text",
  R: "text-info",
};

export function DiffPanel() {
  const connection = useHost((host) => host.connection);
  const updating = usePiUpdates((updates) => updates.updating);
  const turns = useCheckpoints((state) => state.turns);
  const chosen = useDiffTurn();
  const opener = useRef<Element | null>(null);
  const turn = chosen === null ? turns.at(-1) : turns.find((item) => item.turn === chosen);
  const latest = turns.at(-1);
  const turnItems = [
    { value: LATEST, label: "Latest turn" },
    ...turns.map((item) => ({ value: String(item.turn), label: `Turn ${item.turn}` })),
  ];
  // "Turn 2 of 3" on the trigger; the list's "Latest turn" follows new turns as they finish.
  const shownTurn = turn ? `Turn ${turn.turn} of ${latest?.turn ?? turn.turn}` : null;
  const shown = shownTurn ?? (chosen === null ? "Latest turn" : `Turn ${chosen}`);

  // Closing gives focus back to whatever had it when the panel opened, such as the Changes button.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
  }, []);
  useEffect(() => {
    if (!updating && turn?.state === "ready" && connection === "connected")
      readCheckpoint(turn.turn);
  }, [turn?.turn, turn?.state, connection, updating]);

  const close = () => {
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    useDiffPanel.setState(false, true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The turn list renders in a portal. Escape there only closes the list.
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    event.preventDefault();
    close();
  };

  return (
    // In a narrow window, as at 200% zoom, the panel narrows too, so the
    // thread beside it keeps about 320 px (sidebar/layout.ts).
    <aside
      aria-label="Turn changes"
      className="flex w-[min(432px,45vw)] min-w-0 shrink-0 flex-col border-l border-border bg-sidebar"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border ps-4 pe-2">
        <h2 className="text-sm font-medium">Changes</h2>
        <Select
          items={turnItems}
          value={chosen === null ? LATEST : String(chosen)}
          onValueChange={(value) =>
            useDiffTurn.setState(value === null || value === LATEST ? null : Number(value), true)
          }
        >
          <SelectTrigger variant="outline-sm" aria-label="Checkpoint turn">
            <SelectValue>{() => shown}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {turnItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="faint-ghost"
          size="icon"
          aria-label="Close changes"
          className="ms-auto"
          onClick={close}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
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
      <Message>
        <Working>Preparing turn checkpoint…</Working>
      </Message>
    );
  if (!turn)
    return (
      <Message>
        <Notice
          title={unavailable ? "Turn changes unavailable" : "No turn checkpoints yet"}
          description={unavailable ?? "Send a prompt to record file changes."}
        />
      </Message>
    );
  if (turn.state === "running")
    return (
      <Message>
        <p role="status" className="text-sm text-muted-foreground">
          {`Turn ${turn.turn} is running.`}
        </p>
      </Message>
    );
  if (turn.state === "capturing")
    return (
      <Message>
        <Working>{`Capturing turn ${turn.turn}…`}</Working>
      </Message>
    );
  if (turn.state === "unavailable")
    return (
      <Message>
        <Notice title={`No checkpoint for turn ${turn.turn}`} description={turn.reason} />
      </Message>
    );
  if (resultTurn !== turn.turn || diff === null)
    return (
      <Message>
        <Working>Loading changes…</Working>
      </Message>
    );
  if (diff.error !== null)
    return (
      <Message>
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Couldn't read this turn's changes</AlertTitle>
          <AlertDescription>{diff.error}</AlertDescription>
        </Alert>
      </Message>
    );
  // A ready turn's reason names changes the checkpoint couldn't hold, such as inside submodules.
  return <Files key={turn.turn} files={diff.files} note={turn.reason} />;
}

function Message({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 p-3">{children}</div>;
}

function Working({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner size="sm" />
      {children}
    </p>
  );
}

function Notice({ title, description }: { title: string; description: string | null }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileDiff aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function Partial({ note }: { note: string }) {
  return (
    <Alert variant="info">
      <Info aria-hidden />
      <AlertTitle>Some changes aren't shown</AlertTitle>
      <AlertDescription>{note}</AlertDescription>
    </Alert>
  );
}

function Files({ files, note }: { files: readonly CheckpointFile[]; note: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const file = files.find((item) => item.path === selected) ?? files[0];
  if (!file)
    return (
      <Message>
        {note ? <Partial note={note} /> : null}
        <Notice title="No file changes in this turn" description={null} />
      </Message>
    );
  const matching = files.filter((item) => item.path.toLowerCase().includes(filter.toLowerCase()));
  const listed = matching.slice(0, 200);
  return (
    <>
      {note ? (
        <div className="px-2 pt-3">
          <Partial note={note} />
        </div>
      ) : null}
      <div className="shrink-0 px-2 pt-3 pb-1">
        <FilterInput
          aria-label="Filter changed files"
          placeholder="Filter files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <nav aria-label="Changed files" className="shrink-0 border-b border-border">
        <ScrollArea className="max-h-64">
          {/* The padding keeps focus rings inside the scrolling box, which would clip them. */}
          <div className="px-2 pt-1 pb-2">
            <FileTree files={listed} prefix="" selected={file.path} onSelect={setSelected} />
          </div>
        </ScrollArea>
      </nav>
      {matching.length > listed.length ? (
        <p className="shrink-0 px-4 py-2 text-xs text-muted-foreground">
          Showing 200 of {matching.length} matches. Filter by path to find a file.
        </p>
      ) : null}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 font-mono text-xs text-muted-foreground">
        <span className="truncate" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </span>
        <Stats patch={file.patch} className="ms-auto text-2xs" />
      </div>
      <FilePatch file={file} />
    </>
  );
}

function FilePatch({ file }: { file: CheckpointFile }) {
  // The host lists a file with an empty patch when its diff doesn't fit the turn's cap.
  if (!file.patch) return <Note>This file's diff is too large to preview.</Note>;
  if (file.binary) return <Note>Binary file changed. No text preview.</Note>;
  if (!/^@@ /m.test(file.patch)) return <Note>File metadata changed. No text changes.</Note>;
  return (
    <Suspense
      fallback={
        <Message>
          <Working>Loading diff…</Working>
        </Message>
      }
    >
      <DiffView patch={file.patch} fill />
    </Suspense>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="p-3 text-sm text-muted-foreground">{children}</p>;
}

/** The lines a unified patch adds and removes. Nothing for a binary file or a patch left out. */
function countLines(patch: string): { added: number; removed: number } | null {
  if (!patch) return null;
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

function Stats({ patch, className }: { patch: string; className?: string }) {
  const counts = countLines(patch);
  if (!counts) return null;
  return (
    <span className={`flex gap-2 ${className ?? ""}`}>
      <span className="min-w-7 text-right text-addition">+{counts.added}</span>
      <span className="min-w-7 text-right text-deletion">−{counts.removed}</span>
    </span>
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
    <ul className="flex flex-col gap-0.5 font-mono text-xs">
      {folders.map((folder) => {
        const childPrefix = `${prefix}${folder}/`;
        return (
          <li key={childPrefix}>
            <details open>
              <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-control px-2 text-faint-foreground outline-none select-none hover:bg-accent hover:text-foreground focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
                {/* Only this folder's own state turns its chevron, not an open folder around it. */}
                <ChevronRight
                  aria-hidden
                  className="size-3 shrink-0 transition-transform [[open]>summary>&]:rotate-90"
                />
                {folder}/
              </summary>
              <div className="ps-3">
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
          <FileRow
            file={file}
            name={file.path.slice(prefix.length)}
            selected={selected === file.path}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function FileRow({
  file,
  name,
  selected,
  onSelect,
}: {
  file: CheckpointFile;
  name: string;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const statusId = useId();
  const status = STATUS_NAMES[file.status];
  // The label names the file, so the status letter reaches screen readers as the description.
  return (
    <button
      type="button"
      aria-label={`Show diff for ${file.path}`}
      aria-describedby={status ? statusId : undefined}
      aria-pressed={selected}
      onClick={() => onSelect(file.path)}
      className="grid h-7 w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-control px-2 text-left outline-none hover:bg-accent focus-visible:focus-ring aria-pressed:bg-selected"
    >
      <span className={STATUS_COLORS[file.status] ?? "text-muted-foreground"}>{file.status}</span>
      {status ? (
        <span id={statusId} hidden>
          {status}
        </span>
      ) : null}
      <span className="truncate" title={file.path}>
        {name}
      </span>
      <Stats patch={file.patch} />
    </button>
  );
}
