import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import type { CallMeta, CallStatus, CallSummary } from "../tools/model";
import type { CallPreview } from "../tools/preview";
import { Button } from "./button";
import { Spinner } from "./spinner";

const STATUS: Record<CallStatus, string> = {
  writing: "Preparing",
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const TONE: Record<CallStatus, string> = {
  writing: "text-faint-foreground",
  waiting: "text-faint-foreground",
  running: "text-primary-text",
  done: "text-faint-foreground",
  failed: "text-destructive",
  stopped: "text-faint-foreground",
};

/** The whole collapsed row, including its preview, is one keyboard-accessible disclosure. */
export function ToolCallHeader({
  summary,
  status,
  meta,
  preview,
  expanded,
  bodyId,
  onToggle,
}: {
  summary: CallSummary;
  status: CallStatus;
  meta: CallMeta | null;
  preview: CallPreview | null;
  expanded: boolean;
  bodyId: string;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <Button
        variant="outline"
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        onClick={onToggle}
        className="grid h-auto w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto_12px] justify-start gap-x-2 gap-y-1 rounded-none border-0 px-3 py-2 text-left text-xs whitespace-normal focus-visible:ring-inset aria-expanded:bg-transparent"
      >
        <StatusMark status={status} />{" "}
        <span data-tool-title title={summary.title} className="min-w-0 truncate font-medium">
          {summary.title}
        </span>{" "}
        <span className="whitespace-nowrap">
          {status === "done" && meta ? (
            <Meta meta={meta} />
          ) : (
            <span className={TONE[status]}>{STATUS[status]}</span>
          )}
        </span>
        <Chevron aria-hidden className="size-3 text-faint-foreground" />
        {summary.detail ? (
          <span
            data-tool-detail
            title={summary.detail}
            className="col-start-2 col-end-4 min-w-0 truncate font-mono text-muted-foreground"
          >
            {summary.detail}
          </span>
        ) : null}
        {preview && !preview.live ? (
          <span className="col-start-2 col-end-4 mt-1 min-w-0 text-left">
            <PreviewContent preview={preview} />
          </span>
        ) : null}
      </Button>
      {preview?.live ? (
        <div
          role="log"
          aria-label="Latest output"
          className="mx-3 mb-2 ml-9 min-w-0 rounded-control bg-terminal-tail px-3 py-2"
        >
          <PreviewContent preview={preview} />
        </div>
      ) : null}
    </>
  );
}

function StatusMark({ status }: { status: CallStatus }) {
  let mark: ReactNode;
  if (status === "running") mark = <Spinner size="sm" variant="primary" />;
  else if (status === "done") mark = <Check aria-hidden className="size-3.5" />;
  else if (status === "failed") mark = <X aria-hidden className="size-3.5" />;
  else if (status === "stopped") mark = <span className="h-px w-2 bg-current" />;
  else mark = <span className="size-1.5 rounded-full bg-current" />;
  return (
    <span
      role="img"
      aria-label={STATUS[status]}
      className={`flex size-4 items-center justify-center ${TONE[status]}`}
    >
      {mark}
    </span>
  );
}

const META_TONE = {
  faint: "text-faint-foreground",
  success: "text-success",
  failure: "text-destructive",
};

function Meta({ meta }: { meta: CallMeta }) {
  if (meta.kind === "text") return <span className={META_TONE[meta.tone]}>{meta.text}</span>;
  return (
    <span
      aria-label={`${meta.additions} added, ${meta.deletions} removed`}
      className="font-mono tabular-nums"
    >
      <span className="text-addition">+{meta.additions}</span>{" "}
      <span className="text-deletion">−{meta.deletions}</span>
    </span>
  );
}

function PreviewContent({ preview }: { preview: CallPreview }) {
  const label = { diff: "Diff preview", error: "Error preview", output: "Result preview" }[
    preview.kind
  ];
  return (
    <span
      data-tool-preview
      role="note"
      aria-label={label}
      className={`block overflow-hidden border-l-2 pl-2 font-mono text-xs leading-[18px] ${
        preview.kind === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground"
      }`}
    >
      {preview.text.split("\n").map((line, index) => {
        let tone = "";
        if (preview.kind === "diff") {
          if (line.startsWith("+")) tone = "text-addition";
          else if (line.startsWith("-")) tone = "text-deletion";
        }
        return (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- Stateless text lines can repeat; their preview slots are their identity.
            key={index}
            className={`block truncate whitespace-pre ${tone}`}
          >
            {line || "\u00a0"}
            {"\n"}
          </span>
        );
      })}
      {preview.more && !preview.live ? (
        <span className="block font-sans text-faint-foreground">More output…</span>
      ) : null}
    </span>
  );
}
