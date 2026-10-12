// A work log row for one tool call: a one-line grid you click to open, and
// under it the call's output. Rows start closed. A running shell command
// shows its last lines under the row until it ends.
import { Check, X } from "lucide-react";
import { lazy, Suspense, useId, type ReactNode } from "react";
import { toolRun, type ToolOutput } from "../../shared/thread";
import { useThread } from "../thread/store";
import { Spinner } from "../ui/spinner";
import { toggleExpanded, useExpanded } from "./expanded";
import {
  callMeta,
  callOutput,
  callPath,
  callStatus,
  editPatch,
  hasImage,
  lastLines,
  outputText,
  prettyJson,
  readsFromStart,
  splitReadNote,
  summarizeCall,
  toolResults,
  toolVerb,
  writeContent,
  type CallMeta,
  type CallStatus,
  type ToolCall,
} from "./model";
import { OutputView } from "./OutputView";

// @pierre/diffs and its workers load only once a row shows code.
const DiffView = lazy(() => import("./code").then((module) => ({ default: module.DiffView })));
const FileView = lazy(() => import("./code").then((module) => ({ default: module.FileView })));

/** How many lines of a running command's output show under a closed row. */
const PREVIEW_LINES = 5;

const SHELLS = new Set(["bash", "powershell"]);

/** `writing` is true while the model still streams the message that holds the call. */
export function ToolRow({ call, writing }: { call: ToolCall; writing: boolean }) {
  const result = useThread((thread) => toolResults(thread.messages).get(call.id));
  const run = useThread((thread) => toolRun(thread, call.id));
  const piWorking = useThread((thread) => thread.running);
  const expanded = useExpanded((ids) => ids.has(call.id));
  const bodyId = useId();
  const status = callStatus({ writing, result, run, piWorking });
  const output = callOutput(result, run);
  const { subject, within } = summarizeCall(call);
  const patch = call.name === "edit" ? editPatch(output?.details) : undefined;
  const meta = callMeta({ call, status, output, patch });
  const preview =
    status === "running" && !expanded && SHELLS.has(call.name) && output
      ? lastLines(outputText(output.content), PREVIEW_LINES)
      : "";

  return (
    <div data-tool-call={call.id} data-status={status}>
      {/* The ring is inset: the list clips to the card's corners. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        onClick={() => toggleExpanded(call.id)}
        className="grid h-8 w-full grid-cols-[16px_56px_minmax(0,1fr)_auto] items-center gap-x-2 px-3 text-left text-xs outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* The spaces keep the parts apart in the button's name. The grid doesn't draw them. */}
        <StatusMark status={status} />{" "}
        <span
          className={`truncate ${status === "running" ? "text-primary-text" : "text-muted-foreground"}`}
        >
          {toolVerb(call.name)}
        </span>{" "}
        <span title={within ? `${subject} in ${within}` : subject} className="truncate font-mono">
          {subject}
          {within ? (
            <>
              {" "}
              <span className="text-faint-foreground">in</span> {within}
            </>
          ) : null}
        </span>
        {meta ? (
          <>
            {" "}
            <Meta meta={meta} />
          </>
        ) : null}
      </button>
      {preview ? (
        <pre
          role="log"
          aria-label="Latest output"
          className="mx-3 mb-2 ml-9 overflow-hidden rounded-control bg-terminal-tail px-3 py-2 font-mono text-xs leading-[18px] text-muted-foreground"
        >
          {preview}
        </pre>
      ) : null}
      {expanded ? (
        <div id={bodyId} className="border-y border-border">
          <ToolBody call={call} status={status} output={output} patch={patch} />
        </div>
      ) : null}
    </div>
  );
}

const META_TONE = {
  faint: "text-faint-foreground",
  success: "text-success",
  failure: "text-destructive",
};

function Meta({ meta }: { meta: CallMeta }) {
  if (meta.kind === "text") {
    return <span className={`whitespace-nowrap ${META_TONE[meta.tone]}`}>{meta.text}</span>;
  }
  return (
    <span
      aria-label={`${meta.additions} added, ${meta.deletions} removed`}
      className="font-mono tabular-nums whitespace-nowrap"
    >
      <span className="text-addition">+{meta.additions}</span>{" "}
      <span className="text-deletion">−{meta.deletions}</span>
    </span>
  );
}

const STATUS: Record<CallStatus, string> = {
  writing: "Writing",
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** Work in progress takes the primary color, like the dot of a call still being written. */
const TONE: Record<CallStatus, string> = {
  writing: "text-faint-foreground",
  waiting: "text-faint-foreground",
  running: "text-primary",
  done: "text-faint-foreground",
  failed: "text-destructive",
  stopped: "text-faint-foreground",
};

function StatusMark({ status }: { status: CallStatus }) {
  const label = STATUS[status];
  let mark: ReactNode;
  // The spinner repaints every frame, so it shows only while the call runs.
  if (status === "running") mark = <Spinner size="sm" variant="primary" />;
  else if (status === "done") mark = <Check aria-hidden className="size-3.5" />;
  else if (status === "failed") mark = <X aria-hidden className="size-3.5" />;
  else if (status === "stopped") mark = <span className="h-px w-2 bg-current" />;
  else mark = <span className="size-1.5 rounded-full bg-primary" />;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex size-4 items-center justify-center ${TONE[status]}`}
    >
      {mark}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function CodeLoading() {
  return <Note>Loading code…</Note>;
}

/** What a call without output says, by where it stands. */
function noOutput(status: CallStatus): string {
  if (status === "stopped") return "pi stopped before this call finished.";
  if (status === "done" || status === "failed") return "No output.";
  return "No output yet.";
}

export function ToolBody({
  call,
  status,
  output,
  patch,
}: {
  call: ToolCall;
  status: CallStatus;
  output: ToolOutput | null;
  patch: string | undefined;
}) {
  const text = output ? outputText(output.content) : "";
  const failed = status === "failed";
  // A command's last lines matter most, so its output opens at the end.
  const follow = status === "running" || SHELLS.has(call.name);
  const plain = text ? (
    <OutputView text={text} follow={follow} tone={failed ? "error" : "normal"} />
  ) : (
    <Note>{noOutput(status)}</Note>
  );
  const path = callPath(call) ?? "";

  switch (call.name) {
    case "bash":
    case "powershell":
      return plain;
    case "read": {
      if (failed || !output || hasImage(output)) return plain;
      const { body, note } = splitReadNote(text);
      return (
        <>
          <Suspense fallback={<CodeLoading />}>
            <FileView name={path} contents={body} lineNumbers={readsFromStart(call)} />
          </Suspense>
          {note ? <Note>{note}</Note> : null}
        </>
      );
    }
    case "edit":
      if (patch === undefined) return plain;
      return (
        <Suspense fallback={<CodeLoading />}>
          <DiffView patch={patch} />
        </Suspense>
      );
    case "write": {
      const content = writeContent(call);
      if (content === undefined)
        return <Note>{status === "writing" ? "Writing…" : "No content."}</Note>;
      return (
        <>
          <Suspense fallback={<CodeLoading />}>
            <FileView name={path} contents={content} lineNumbers />
          </Suspense>
          {failed ? plain : null}
        </>
      );
    }
    case "grep":
    case "find":
    case "ls":
      return plain;
    default:
      // An extension's tool. Its custom renderer only exists in pi's terminal UI.
      return (
        <>
          <Note>Arguments</Note>
          <OutputView text={prettyJson(call.arguments)} label="Arguments" />
          <Note>Result</Note>
          {plain}
        </>
      );
  }
}
