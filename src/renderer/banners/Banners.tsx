// Banners above the composer: pi stopped, a retry, a compaction, and errors
// the host reported. The wording of the retry and compaction banners follows
// pi's own status lines. Errors are alerts, which screen readers announce at
// once, and the rest are statuses, which they announce when they're idle.
import { ChevronRight, CircleAlert, RotateCw, X } from "lucide-react";
import type { CompactionReason, Retry } from "../../shared/thread";
import { dismissError, restartPi, useHost, usePi } from "../connection";
import { useThread } from "../thread/store";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stripAnsi } from "./ansi";

// Alert centers its icon and button on the whole text unless there's a
// description, so each banner keeps them on the first line of its text. Beside
// a 24 px button, the title's 2 px margins make that line as tall as the
// button, and the icon sits 4 px down. Without a button, the icon sits 2 px
// down, as Alert puts it beside a description. One line looks as it did.

function PiStopped({ error }: { error: string }) {
  // PiExitError puts the exit on the first line and pi's stderr, colors and all, after it.
  const [summary, ...rest] = stripAnsi(error).split("\n");
  const details = rest.join("\n").trim();
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden className={details ? undefined : "self-start translate-y-1"} />
      <AlertTitle className={details ? "break-words" : "my-0.5 break-words"}>{summary}</AlertTitle>
      {details ? (
        <AlertDescription>
          <details className="group/details">
            <summary className="inline-flex cursor-default list-none items-center gap-1 rounded-sm text-xs outline-none select-none hover:text-foreground focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3 transition-transform duration-150 group-open/details:rotate-90"
              />
              Details
            </summary>
            <pre className="mt-1.5 max-h-40 overflow-auto text-xs whitespace-pre-wrap">
              {details}
            </pre>
          </details>
        </AlertDescription>
      ) : null}
      {/* On the summary's line, so opening the details doesn't move it. */}
      <AlertAction className="self-start">
        <Button size="xs" onClick={restartPi}>
          Restart pi
        </Button>
      </AlertAction>
    </Alert>
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
  const pi = usePi();
  const errors = useHost((host) => host.errors);
  const retry = useThread((thread) => thread.retry);
  const compaction = useThread((thread) => thread.compaction);

  return (
    <div className="mb-2 flex flex-col gap-2 empty:hidden">
      {/* A pi Tondo couldn't find or can't run is explained in the main area instead. */}
      {pi.state === "exited" && pi.problem === undefined ? <PiStopped error={pi.error} /> : null}
      {retry ? (
        <Alert variant="warning" role="status">
          <RotateCw aria-hidden className="self-start translate-y-0.5" />
          <AlertTitle>{retryText(retry)}</AlertTitle>
          {retry.errorMessage ? (
            <AlertDescription className="break-words">{retry.errorMessage}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}
      {compaction ? (
        <Alert role="status">
          {/* It spins only while pi compacts, and the banner goes when pi is done. */}
          <Spinner className="self-start translate-y-0.5" />
          <AlertTitle>{compactionText(compaction)}</AlertTitle>
        </Alert>
      ) : null}
      {errors.map((error) => (
        <Alert key={error} variant="destructive" role="alert">
          <CircleAlert aria-hidden className="self-start translate-y-1" />
          <AlertTitle className="my-0.5 break-words whitespace-pre-wrap">{error}</AlertTitle>
          <AlertAction className="self-start">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss error"
              onClick={() => dismissError(error)}
            >
              <X aria-hidden />
            </Button>
          </AlertAction>
        </Alert>
      ))}
    </div>
  );
}
