// A compact action summary and result preview. Clicking anywhere in the
// header opens the exact inputs and the full result; expansion stays user-controlled.
import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import { toolRun, type ToolOutput } from "../../shared/thread";
import { useThread } from "../thread/store";
import { Button } from "../ui/button";
import { ToolCallHeader } from "../ui/tool-call";
import { toggleExpanded, useExpanded } from "./expanded";
import {
  callMeta,
  callOutput,
  callPath,
  callStatus,
  editPatch,
  hasImage,
  outputText,
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
import { OutputImages } from "./OutputImages";
import { callPreview } from "./preview";

// @pierre/diffs and its workers load only once a row shows code.
const DiffView = lazy(() => import("./code").then((module) => ({ default: module.DiffView })));
const FileView = lazy(() => import("./code").then((module) => ({ default: module.FileView })));

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
  const patch = call.name === "edit" ? editPatch(output?.details) : undefined;
  const meta = callMeta({ call, status, output, patch });
  const preview = expanded ? null : callPreview({ call, status, output, patch });

  return (
    <div data-tool-call={call.id} data-status={status}>
      <ToolCallHeader
        summary={summarizeCall(call)}
        status={status}
        meta={meta}
        preview={preview}
        expanded={expanded}
        bodyId={bodyId}
        onToggle={() => toggleExpanded(call.id)}
      />
      {expanded ? (
        <div id={bodyId} className="border-y border-border">
          <ToolInput call={call} />
          <Note>Result</Note>
          <ToolBody call={call} status={status} output={output} patch={patch} />
        </div>
      ) : null}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

/** Commands keep their real newlines rather than JSON escapes. All other inputs stay exact. */
function ToolInput({ call }: { call: ToolCall }) {
  // Raw edits and writes duplicate whole files. Don't serialize or draw them until requested.
  const largeInput = call.name === "edit" || call.name === "write";
  const [showArguments, setShowArguments] = useState(!largeInput);
  const argumentsId = useId();
  const command =
    SHELLS.has(call.name) && typeof call.arguments.command === "string"
      ? call.arguments.command
      : null;
  const args =
    command === null
      ? call.arguments
      : Object.fromEntries(Object.entries(call.arguments).filter(([key]) => key !== "command"));
  return (
    <>
      <Note>Tool: {call.name}</Note>
      {command !== null ? <OutputView text={command} label="Command" /> : null}
      {largeInput ? (
        <Button
          variant="ghost"
          size="sm"
          className="mx-3 mb-2"
          aria-expanded={showArguments}
          aria-controls={showArguments ? argumentsId : undefined}
          onClick={() => setShowArguments((shown) => !shown)}
        >
          {showArguments ? "Hide arguments" : "Show arguments"}
        </Button>
      ) : null}
      {showArguments && (command === null || Object.keys(args).length > 0) ? (
        <div id={argumentsId}>
          {!largeInput ? <Note>Arguments</Note> : null}
          <OutputView text={prettyJson(args)} label="Arguments" />
        </div>
      ) : null}
    </>
  );
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
  const text = output ? outputText(output.content, { imageLabels: false }) : "";
  const failed = status === "failed";
  // A command's last lines matter most, so its output opens at the end.
  const follow = status === "running" || SHELLS.has(call.name);
  const images = output ? <OutputImages content={output.content} initiallyVisible /> : null;
  const plain = (
    <>
      {text ? (
        <OutputView text={text} follow={follow} tone={failed ? "error" : "normal"} />
      ) : output && hasImage(output) ? null : (
        <Note>{noOutput(status)}</Note>
      )}
      {images}
    </>
  );
  const path = callPath(call) ?? "";

  switch (call.name) {
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
        <>
          <Suspense fallback={<CodeLoading />}>
            <DiffView patch={patch} />
          </Suspense>
          {images}
        </>
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
          {failed ? plain : images}
        </>
      );
    }
    default:
      return plain;
  }
}
