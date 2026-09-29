// Diffs and files for tool cards, highlighted by @pierre/diffs in a pool of
// web workers. The page loads this module the first time a card shows a diff
// or a file, and until then it neither loads @pierre/diffs nor starts workers.
// The shared pool follows T3 Code's apps/web/src/components/DiffWorkerPoolProvider.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import {
  File,
  PatchDiff,
  Virtualizer,
  WorkerPoolContext,
  type FileContents,
  type FileDiffOptions,
  type FileOptions,
} from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/** Workers in the pool. Each one loads its own Shiki and grammars. */
const POOL_SIZE = 2;
/** How long the pool outlives the last code view, so scrolling past cards doesn't restart it. */
const IDLE_MS = 30_000;

interface SharedPool {
  readonly manager: WorkerPoolManager;
  users: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

let shared: SharedPool | undefined;

/** Starts the pool, or keeps it from stopping. Call the function it returns when done with it. */
function acquirePool(): () => void {
  const pool = (shared ??= {
    manager: new WorkerPoolManager(
      { workerFactory: () => new DiffsWorker(), poolSize: POOL_SIZE },
      // Shiki's JavaScript regex engine, like the code blocks'. The WASM one
      // would need 'wasm-unsafe-eval' in the CSP.
      { preferredHighlighter: "shiki-js" },
    ),
    users: 0,
    idleTimer: undefined,
  });
  clearTimeout(pool.idleTimer);
  pool.idleTimer = undefined;
  pool.users++;
  return () => {
    pool.users--;
    if (pool.users > 0) return;
    pool.idleTimer = setTimeout(() => {
      pool.manager.terminate();
      if (shared === pool) shared = undefined;
    }, IDLE_MS);
  };
}

// Subscribing holds the pool, so each mounted view keeps it running.
function subscribeToPool(onChange: () => void): () => void {
  const release = acquirePool();
  onChange();
  return release;
}

const currentPool = () => shared?.manager;
const noPool = () => undefined;

/**
 * Renders `children` inside the pool once it has started. Until then the
 * pool can't build a view's rows at all, since it builds even uncolored rows
 * with a highlighter it makes while it starts. T3 Code waits the same way.
 */
function WithPool({ children }: { children: ReactNode }) {
  const pool = useSyncExternalStore(subscribeToPool, currentPool, noPool);
  const [readyPool, setReadyPool] = useState<WorkerPoolManager>();
  const ready = pool !== undefined && (readyPool === pool || pool.isInitialized());

  useEffect(() => {
    if (!pool || ready) return;
    let mounted = true;
    // A pool that fails falls back to highlighting on the main thread.
    const finish = () => {
      if (mounted) setReadyPool(pool);
    };
    pool.initialize().then(finish, finish);
    return () => {
      mounted = false;
    };
  }, [pool, ready]);

  if (!ready) {
    return (
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
        Loading code…
      </p>
    );
  }
  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
}

/** The card's scroll box. Only the lines in and near the view are on the page. */
function CodeBox({ children }: { children: ReactNode }) {
  return (
    <Virtualizer className="max-h-[360px] overflow-auto [--diffs-font-family:var(--font-mono)]">
      {children}
    </Virtualizer>
  );
}

/**
 * The most lines a diff side can have and still get syntax colors. The
 * worker sends its colors back as one message, and taking it in is one task on
 * the main thread that grows with the diff: about 90 ms for 5,000 lines a side
 * on an M5, against the 100 ms budget for long tasks. A bigger diff shows
 * uncolored, at once. A file gets colors up to the same total, 5,000 lines.
 */
const MAX_COLORED_DIFF_LINES = 2500;
const MAX_COLORED_FILE_LINES = 2 * MAX_COLORED_DIFF_LINES;

const DIFF_OPTIONS: FileDiffOptions<undefined, undefined> = {
  diffStyle: "unified",
  overflow: "scroll",
  // The card's header already names the file.
  disableFileHeader: true,
  tokenizeMaxLength: MAX_COLORED_DIFF_LINES,
};

/** A single-file unified patch, like the one pi's edit reports. */
export function DiffView({ patch }: { patch: string }) {
  return (
    <WithPool>
      <CodeBox>
        <PatchDiff patch={patch} options={DIFF_OPTIONS} />
      </CodeBox>
    </WithPool>
  );
}

const WITH_NUMBERS: FileOptions<undefined, undefined> = {
  overflow: "scroll",
  disableFileHeader: true,
  tokenizeMaxLength: MAX_COLORED_FILE_LINES,
};
const WITHOUT_NUMBERS: FileOptions<undefined, undefined> = {
  ...WITH_NUMBERS,
  disableLineNumbers: true,
};

/**
 * A file's text, highlighted for the language its name suggests. pierre
 * numbers lines from 1, so turn `lineNumbers` off for text that starts
 * further in.
 */
export function FileView({
  name,
  contents,
  lineNumbers,
}: {
  name: string;
  contents: string;
  lineNumbers: boolean;
}) {
  // pierre would number the empty line after a final newline, which editors don't show.
  const file: FileContents = { name, contents: contents.replace(/\n$/, "") };
  return (
    <WithPool>
      <CodeBox>
        <File file={file} options={lineNumbers ? WITH_NUMBERS : WITHOUT_NUMBERS} />
      </CodeBox>
    </WithPool>
  );
}
