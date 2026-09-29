// A card for one tool call: a one-line header you click to open, and a body
// with the call's output. Cards start closed. A running shell command shows
// its last lines under the header until it ends.
import { lazy, Suspense, type ReactNode } from "react";
import { toolRun, type ToolOutput } from "../../shared/thread";
import { useThread } from "../thread/store";
import { CheckIcon, ChevronIcon, CrossIcon } from "../ui/icons";
import { toggleExpanded, useExpanded } from "./expanded";
import {
  callOutput,
  callPath,
  callStatus,
  editPatch,
  hasImage,
  lastLines,
  outputText,
  patchStats,
  prettyJson,
  readsFromStart,
  splitReadNote,
  summarizeCall,
  toolResults,
  writeContent,
  type CallStatus,
  type ToolCall,
} from "./model";
import { OutputView } from "./OutputView";

// @pierre/diffs and its workers load only once a card shows code.
const DiffView = lazy(() => import("./code").then((module) => ({ default: module.DiffView })));
const FileView = lazy(() => import("./code").then((module) => ({ default: module.FileView })));

/** How many lines of a running command's output show under a closed card. */
const PREVIEW_LINES = 5;

const SHELLS = new Set(["bash", "powershell"]);

/** `writing` is true while the model still streams the message that holds the call. */
export function ToolCard({ call, writing }: { call: ToolCall; writing: boolean }) {
  const result = useThread((thread) => toolResults(thread.messages).get(call.id));
  const run = useThread((thread) => toolRun(thread, call.id));
  const piWorking = useThread((thread) => thread.running);
  const expanded = useExpanded((ids) => ids.has(call.id));
  const status = callStatus({ writing, result, run, piWorking });
  const output = callOutput(result, run);
  const { subject, detail } = summarizeCall(call);
  const patch = call.name === "edit" ? editPatch(output?.details) : undefined;
  const stats = patch === undefined ? null : patchStats(patch);
  const preview =
    status === "running" && !expanded && SHELLS.has(call.name) && output
      ? lastLines(outputText(output.content), PREVIEW_LINES)
      : "";

  return (
    <div
      className="my-2 rounded-control border border-border bg-card"
      data-tool-call={call.id}
      data-status={status}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggleExpanded(call.id)}
        className="flex w-full min-w-0 items-center gap-2 rounded-control px-3 py-1.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The spaces keep the parts apart in the button's name. The flex row doesn't draw them. */}
        <StatusMark status={status} /> <span className="shrink-0 font-medium">{call.name}</span>{" "}
        <span
          title={subject}
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {subject}
        </span>
        {detail ? (
          <>
            {" "}
            <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
          </>
        ) : null}
        {stats ? (
          <>
            {" "}
            <span
              aria-label={`${stats.additions} added, ${stats.deletions} removed`}
              className="shrink-0 font-mono text-xs tabular-nums"
            >
              <span className="text-addition">+{stats.additions}</span>{" "}
              <span className="text-deletion">−{stats.deletions}</span>
            </span>
          </>
        ) : null}
        <ChevronIcon open={expanded} />
      </button>
      {preview ? (
        <pre
          role="log"
          aria-label="Latest output"
          className="overflow-hidden px-3 pb-2 font-mono text-xs leading-[18px] text-muted-foreground"
        >
          {preview}
        </pre>
      ) : null}
      {expanded ? (
        <div className="border-t border-border">
          <ToolBody call={call} status={status} output={output} patch={patch} />
        </div>
      ) : null}
    </div>
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

function StatusMark({ status }: { status: CallStatus }) {
  const label = STATUS[status];
  let mark: ReactNode;
  if (status === "done") mark = <CheckIcon />;
  else if (status === "failed") mark = <CrossIcon />;
  else if (status === "stopped") mark = <span className="h-px w-2 bg-current" />;
  else mark = <span className="size-1.5 rounded-full bg-primary" />;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex size-3.5 shrink-0 items-center justify-center ${
        status === "failed" ? "text-destructive" : "text-muted-foreground"
      }`}
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

function ToolBody({
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
          <OutputView text={prettyJson(call.arguments)} />
          <Note>Result</Note>
          {plain}
        </>
      );
  }
}
