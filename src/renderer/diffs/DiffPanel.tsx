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
import { create } from "zustand";
import type { CheckpointFile, CheckpointTurn } from "../../shared/checkpoints";
import { listCheckpoints, readCheckpoint, useCheckpoints, useHost } from "../connection";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";

export const useDiffPanel = create<boolean>(() => false);
export function toggleDiffPanel(): void {
  useDiffPanel.setState(!useDiffPanel.getState(), true);
}

const DiffView = lazy(() => import("../tools/code").then((code) => ({ default: code.DiffView })));

const LATEST = "latest";

const STATUS_NAMES: Record<string, string> = {
  A: "Added",
  C: "Copied",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
  T: "Type changed",
  U: "Unmerged",
};

// Modified, the usual case, stays muted. Warning text would fall below 4.5:1 on the light card.
const STATUS_COLORS: Record<string, string> = {
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
};

export function DiffPanel() {
  const threadId = useHost((host) => host.thread?.id);
  const connection = useHost((host) => host.connection);
  const turns = useCheckpoints((state) => state.turns);
  const shared = useCheckpoints((state) => state.shared);
  const [chosen, setChosen] = useState<number | null>(null);
  const opener = useRef<Element | null>(null);
  const turn = chosen === null ? turns.at(-1) : turns.find((item) => item.turn === chosen);
  const turnItems = [
    { value: LATEST, label: "Latest turn" },
    ...turns.map((item) => ({ value: String(item.turn), label: `Turn ${item.turn}` })),
  ];

  // Closing gives focus back to whatever had it when the panel opened, such as the Changes button.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
  }, []);
  useEffect(() => {
    if (threadId && connection === "connected") listCheckpoints();
  }, [threadId, connection]);
  useEffect(() => {
    if (turn?.state === "ready" && connection === "connected") readCheckpoint(turn.turn);
  }, [turn?.turn, turn?.state, connection]);

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
      className="flex w-[min(420px,45vw)] min-w-0 shrink-0 flex-col border-l border-border bg-card"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border ps-4 pe-2">
        <h2 className="text-sm font-medium">Turn changes</h2>
        <Button variant="ghost" size="xs" aria-label="Close changes" onClick={close}>
          <X aria-hidden />
          Close
        </Button>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Turn</span>
          <Select
            items={turnItems}
            value={chosen === null ? LATEST : String(chosen)}
            onValueChange={(value) =>
              setChosen(value === null || value === LATEST ? null : Number(value))
            }
          >
            <SelectTrigger aria-label="Checkpoint turn" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {turnItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Each turn includes steering and follow-ups until pi becomes idle.{" "}
          {shared
            ? "Other open threads share this folder. Their edits can appear here."
            : "Checkpoints cover the whole checkout, including edits made outside this thread."}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
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
  if (!turn && preparing) return <Working>Preparing turn checkpoint…</Working>;
  if (!turn)
    return (
      <Notice
        title={unavailable ? "Turn changes unavailable" : "No turn checkpoints yet"}
        description={unavailable ?? "Send a prompt to record file changes."}
      />
    );
  if (turn.state === "running")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {`Turn ${turn.turn} is running.`}
      </p>
    );
  if (turn.state === "capturing") return <Working>{`Capturing turn ${turn.turn}…`}</Working>;
  if (turn.state === "unavailable")
    return <Notice title={`No checkpoint for turn ${turn.turn}`} description={turn.reason} />;
  if (resultTurn !== turn.turn || diff === null) return <Working>Loading changes…</Working>;
  if (diff.error !== null)
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert aria-hidden />
        <AlertTitle>Couldn't read this turn's changes</AlertTitle>
        <AlertDescription>{diff.error}</AlertDescription>
      </Alert>
    );
  // A ready turn's reason names changes the checkpoint couldn't hold, such as inside submodules.
  if (!turn.reason) return <Files key={turn.turn} files={diff.files} />;
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="info">
        <Info aria-hidden />
        <AlertTitle>Some changes aren't shown</AlertTitle>
        <AlertDescription>{turn.reason}</AlertDescription>
      </Alert>
      <Files key={turn.turn} files={diff.files} />
    </div>
  );
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

function Files({ files }: { files: readonly CheckpointFile[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const file = files.find((item) => item.path === selected) ?? files[0];
  if (!file) return <Notice title="No file changes in this turn" description={null} />;
  const matching = files.filter((item) => item.path.toLowerCase().includes(filter.toLowerCase()));
  const listed = matching.slice(0, 200);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium">Changed files ({files.length})</h3>
      <Input
        aria-label="Filter changed files"
        placeholder="Filter files…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <nav aria-label="Changed files">
        <ScrollArea className="max-h-52">
          {/* The padding keeps focus rings inside the scrolling box, which would clip them. */}
          <div className="p-1">
            <FileTree files={listed} prefix="" selected={file.path} onSelect={setSelected} />
          </div>
        </ScrollArea>
      </nav>
      {matching.length > listed.length ? (
        <p className="text-xs text-muted-foreground">
          Showing 200 of {matching.length} matches. Filter by path to find a file.
        </p>
      ) : null}
      <h3 className="font-mono text-xs break-all">
        {file.previousPath ? `${file.previousPath} → ` : ""}
        {file.path}
      </h3>
      <FilePatch file={file} />
    </div>
  );
}

function FilePatch({ file }: { file: CheckpointFile }) {
  // The host lists a file with an empty patch when its diff doesn't fit the turn's cap.
  if (!file.patch)
    return (
      <p className="text-sm text-muted-foreground">This file's diff is too large to preview.</p>
    );
  if (file.binary)
    return <p className="text-sm text-muted-foreground">Binary file changed. No text preview.</p>;
  if (!/^@@ /m.test(file.patch))
    return <p className="text-sm text-muted-foreground">File metadata changed. No text changes.</p>;
  return (
    <Suspense fallback={<Working>Loading diff…</Working>}>
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
    <ul className="flex flex-col gap-0.5 text-xs">
      {folders.map((folder) => {
        const childPrefix = `${prefix}${folder}/`;
        return (
          <li key={childPrefix}>
            <details open>
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-control px-1 py-1 font-mono text-muted-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
                {/* Only this folder's own state turns its chevron, not an open folder around it. */}
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 transition-transform [[open]>summary>&]:rotate-90"
                />
                {folder}/
              </summary>
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
      className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:focus-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      <span
        className={`w-3 shrink-0 font-mono ${STATUS_COLORS[file.status] ?? "text-muted-foreground"}`}
      >
        {file.status}
      </span>
      {status ? (
        <span id={statusId} hidden>
          {status}
        </span>
      ) : null}
      <span className="truncate font-mono" title={file.path}>
        {name}
      </span>
    </button>
  );
}
