// The status row's Git pill: which checkout the thread runs in, what's
// uncommitted, and how the branch stands against its upstream.
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  File,
  Folder,
  FolderGit2,
  GitPullRequest,
} from "lucide-react";
import type { ReactNode } from "react";
import { useGit, useHost } from "../connection";
import { Button } from "../ui/button";
import { changesLabel, progressLabel, trackingLabel, uncommittedLabel } from "./labels";

/** Nothing for a folder that isn't a Git checkout, and a warning when Git can't read it. */
export function GitPill() {
  const status = useGit((git) => git.status);
  const error = useGit((git) => git.error);
  const worktree = useHost((host) => host.thread?.worktree ?? false);
  const cwd = useHost((host) => host.thread?.project ?? "");
  if (!status?.root) {
    if (!error) return null;
    return (
      <Pill>
        <Segment title={error} tone="warning">
          <CircleAlert aria-hidden />
          Git unavailable
        </Segment>
      </Pill>
    );
  }
  const tracking = status.upstream ? trackingLabel(status, status.upstream) : null;
  const progress = progressLabel(status);
  const pr = status.github.pr;
  return (
    <Pill>
      <Segment title={worktree ? cwd : "Shared checkout"}>
        {worktree ? <FolderGit2 aria-hidden /> : <Folder aria-hidden />}
        {worktree ? "Worktree" : "Local"}
      </Segment>
      <Divider />
      <Segment title={uncommittedLabel(status)}>
        <File aria-hidden />
        <span className="tabular-nums">{changesLabel(status)}</span>
      </Segment>
      {tracking ? (
        <>
          <Divider />
          <Segment title={tracking}>
            <ArrowUp aria-hidden />
            <span aria-hidden className="tabular-nums">
              {status.ahead}
            </span>
            {status.behind ? (
              <>
                <ArrowDown aria-hidden />
                <span aria-hidden className="tabular-nums">
                  {status.behind}
                </span>
              </>
            ) : null}
            <span className="sr-only">{tracking}</span>
          </Segment>
        </>
      ) : null}
      {progress ? (
        <>
          <Divider />
          <Segment tone="warning">
            <CircleAlert aria-hidden />
            {progress}
          </Segment>
        </>
      ) : null}
      {pr ? (
        <>
          <Divider />
          <Button
            variant="ghost"
            size="xs"
            className="h-full"
            render={
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                title={`${pr.title} · ${pr.state.toLowerCase()}`}
              />
            }
          >
            <GitPullRequest aria-hidden />
            {`PR ${pr.number}`}
          </Button>
        </>
      ) : null}
    </Pill>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div
      aria-label="Git status"
      className="flex h-5.5 shrink-0 items-center overflow-hidden rounded-chip border border-border text-2xs whitespace-nowrap text-muted-foreground"
    >
      {children}
    </div>
  );
}

function Segment({
  title,
  tone = "default",
  children,
}: {
  title?: string;
  tone?: "default" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`flex h-full items-center gap-1 px-2 hover:bg-accent hover:text-foreground [&>svg]:size-3 [&>svg]:shrink-0 ${
        tone === "warning" ? "text-warning-text" : ""
      }`}
    >
      {children}
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-input" />;
}
