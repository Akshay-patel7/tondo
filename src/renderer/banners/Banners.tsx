// Banners above the composer: pi stopped, a retry, a compaction, and errors
// the host reported. The wording of the retry and compaction banners follows
// pi's own status lines.
import type { ReactNode } from "react";
import type { CompactionReason, Retry } from "../../shared/thread";
import { dismissError, restartPi, useHost } from "../connection";
import { useThread } from "../thread/store";

const TONES = {
  error: "border-destructive/30 bg-destructive/8",
  warning: "border-warning/30 bg-warning/8",
  info: "border-border bg-muted",
};

function Banner({
  tone,
  alert,
  children,
  action,
}: {
  tone: keyof typeof TONES;
  /** Screen readers announce an alert at once, and a status when they're idle. */
  alert: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-panel border px-4 py-2 text-sm ${TONES[tone]}`}
    >
      <div className="min-w-0 flex-1 py-0.5">{children}</div>
      {action}
    </div>
  );
}

function PiStopped({ error }: { error: string }) {
  // PiExitError puts the exit on the first line and pi's stderr after it.
  const [summary, ...rest] = error.split("\n");
  const details = rest.join("\n").trim();
  return (
    <Banner
      tone="error"
      alert
      action={
        <button
          type="button"
          onClick={restartPi}
          className="shrink-0 rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Restart pi
        </button>
      }
    >
      <p className="font-medium">{summary}</p>
      {details ? (
        <details className="mt-1">
          <summary className="cursor-default text-xs text-muted-foreground select-none">
            Details
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto text-xs whitespace-pre-wrap">{details}</pre>
        </details>
      ) : null}
    </Banner>
  );
}

function retryText({ attempt, maxAttempts, delayMs }: Retry): string {
  return `Retrying (${attempt}/${maxAttempts}) in ${Math.ceil(delayMs / 1000)} s. Escape cancels.`;
}

function compactionText(reason: CompactionReason): string {
  if (reason === "manual") return "Compacting context. Escape cancels.";
  const overflow = reason === "overflow" ? "Context overflow detected. " : "";
  return `${overflow}Auto-compacting. Escape cancels.`;
}

export function Banners() {
  const pi = useHost((host) => host.workspace.pi);
  const errors = useHost((host) => host.errors);
  const retry = useThread((thread) => thread.retry);
  const compaction = useThread((thread) => thread.compaction);

  return (
    <div className="mb-2 flex flex-col gap-2 empty:hidden">
      {pi.state === "exited" ? <PiStopped error={pi.error} /> : null}
      {retry ? (
        <Banner tone="warning" alert={false}>
          <p className="font-medium">{retryText(retry)}</p>
          <p className="mt-0.5 text-xs break-words text-muted-foreground">{retry.errorMessage}</p>
        </Banner>
      ) : null}
      {compaction ? (
        <Banner tone="info" alert={false}>
          <p>{compactionText(compaction)}</p>
        </Banner>
      ) : null}
      {errors.map((error) => (
        <Banner
          key={error}
          tone="error"
          alert
          action={
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => dismissError(error)}
              className="shrink-0 rounded-control px-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              ×
            </button>
          }
        >
          <p className="break-words whitespace-pre-wrap">{error}</p>
        </Banner>
      ))}
    </div>
  );
}
