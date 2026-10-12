// The header's Git control: "Commit & push", and behind its chevron the menu
// with every other Git action. It replaces the footer's Git toolbar.
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestCreateArrow,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import type { GitAction as GitActionKind } from "../../shared/git";
import { refreshGit, useGit, useHost } from "../connection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import { SplitButton, SplitButtonMain, SplitButtonTrigger } from "../ui/split-button";
import { ActionDialog, RemoveMissingWorktreeDialog, type Action } from "./dialogs";
import { progressLabel } from "./labels";

/**
 * Nothing for a folder that isn't a Git checkout. A worktree thread keeps
 * the control even when Git can't read its checkout, so you can remove a
 * worktree whose folder was deleted outside Tondo.
 */
export function GitActions() {
  const status = useGit((git) => git.status);
  const error = useGit((git) => git.error);
  const busy = useGit((git) => git.busy);
  const connected = useHost((host) => host.connection === "connected");
  const worktree = useHost((host) => host.thread?.worktree ?? false);
  const cwd = useHost((host) => host.thread?.project ?? "");
  const [action, setAction] = useState<Action | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const main = useRef<HTMLButtonElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  // The part that opened the dialog on screen, which takes focus back when it closes.
  const opener = useRef<HTMLButtonElement | null>(null);
  // Set when a commit succeeds with a push to follow, and read once its dialog has gone.
  const followUp = useRef<"push" | null>(null);
  const disabled = busy || !connected;
  const root = status?.root ?? null;
  if (!root && !error && !worktree) return null;

  const open = (kind: GitActionKind["kind"], from: "main" | "menu", next?: "push") => {
    if (!status) return;
    opener.current = from === "main" ? main.current : chevron.current;
    setAction({ id: (action?.id ?? 0) + 1, kind, status, ...(next ? { next } : {}) });
    setActionOpen(true);
  };
  // A commit that cleaned the tree disables Commit & push, so focus takes the chevron instead.
  const finalFocus = () =>
    opener.current && !opener.current.disabled ? opener.current : chevron.current;
  const close = (done: boolean) => {
    if (done && action?.next) followUp.current = action.next;
    setActionOpen(false);
  };
  // The push waits for the commit dialog to leave, and skips a checkout that lost its remote meanwhile.
  const closed = () => {
    setAction(null);
    const next = followUp.current;
    followUp.current = null;
    const latest = useGit.getState().status;
    if (next === "push" && latest?.branch && latest.remote) {
      setAction({ id: (action?.id ?? 0) + 1, kind: "push", status: latest });
      setActionOpen(true);
    }
  };

  const pr = status?.github.pr ?? null;
  const can = {
    commit:
      !!status &&
      !disabled &&
      (status.changes > 0 || status.untrackedHidden === true) &&
      !!status.branch &&
      !status.conflicts,
    push: !!status && !disabled && !!status.branch && !!status.remote,
    // Not while Git is stopped in a merge, rebase, cherry-pick or revert.
    pull: !!status && !disabled && !!status.branch && !!status.upstream && !status.operation,
    createPr:
      !!status &&
      pr?.state !== "OPEN" &&
      !disabled &&
      status.github.state === "ready" &&
      !!status.branch,
    removeWorktree: worktree && !disabled,
  };
  const note = status && root ? (error ?? progressLabel(status)) : (error ?? "Reading Git status…");

  return (
    <>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-input" />
      <SplitButton className="app-no-drag">
        <SplitButtonMain
          ref={main}
          disabled={!can.commit || !can.push}
          onClick={() => open("commit", "main", "push")}
        >
          {busy ? <Spinner size="sm" /> : <GitCommitHorizontal aria-hidden />}
          <span className="@max-2xl:sr-only">Commit &amp; push</span>
        </SplitButtonMain>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SplitButtonTrigger ref={chevron} aria-label="Git actions" />}
          />
          <DropdownMenuContent align="end">
            {root && status ? (
              <>
                <DropdownMenuGroup>
                  {note ? <DropdownMenuLabel className="max-w-72">{note}</DropdownMenuLabel> : null}
                  <DropdownMenuItem disabled={!can.commit} onClick={() => open("commit", "menu")}>
                    <GitCommitHorizontal aria-hidden />
                    Commit
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!can.push} onClick={() => open("push", "menu")}>
                    <ArrowUpFromLine aria-hidden />
                    Push
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!can.pull} onClick={() => open("pull", "menu")}>
                    <ArrowDownToLine aria-hidden />
                    Pull
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuGroup>
                  {status.github.message ? (
                    <DropdownMenuLabel className="max-w-72">
                      {status.github.message}
                    </DropdownMenuLabel>
                  ) : null}
                  {pr ? (
                    <DropdownMenuItem
                      render={<a href={pr.url} target="_blank" rel="noreferrer" title={pr.title} />}
                    >
                      <GitPullRequest aria-hidden />
                      {`PR #${pr.number} · ${pr.state.toLowerCase()}`}
                      <ExternalLink aria-hidden />
                    </DropdownMenuItem>
                  ) : null}
                  {pr?.state !== "OPEN" ? (
                    <DropdownMenuItem
                      disabled={!can.createPr}
                      onClick={() => open("create-pr", "menu")}
                    >
                      <GitPullRequestCreateArrow aria-hidden />
                      Create PR
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={disabled} onClick={() => open("switch", "menu")}>
                  <GitBranch aria-hidden />
                  Switch branch
                </DropdownMenuItem>
                <DropdownMenuItem disabled={disabled} onClick={() => open("create-branch", "menu")}>
                  <GitBranchPlus aria-hidden />
                  New branch
                </DropdownMenuItem>
                <DropdownMenuItem disabled={disabled} onClick={() => open("new-worktree", "menu")}>
                  <FolderGit2 aria-hidden />
                  New worktree
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup>
              {!root && note ? (
                <DropdownMenuLabel className="max-w-72">{note}</DropdownMenuLabel>
              ) : null}
              <DropdownMenuItem disabled={disabled} onClick={refreshGit}>
                <RefreshCw aria-hidden />
                Refresh
              </DropdownMenuItem>
              {worktree ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!can.removeWorktree}
                  onClick={() => {
                    if (root) open("remove-worktree", "menu");
                    else {
                      opener.current = chevron.current;
                      setRepairing(true);
                    }
                  }}
                >
                  <Trash2 aria-hidden />
                  Remove worktree
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SplitButton>
      {action ? (
        <ActionDialog
          key={action.id}
          action={action}
          open={actionOpen}
          worktree={worktree}
          cwd={cwd}
          finalFocus={finalFocus}
          close={close}
          closed={closed}
        />
      ) : null}
      {worktree ? (
        <RemoveMissingWorktreeDialog
          open={repairing}
          cwd={cwd}
          finalFocus={finalFocus}
          close={() => setRepairing(false)}
        />
      ) : null}
    </>
  );
}
