import {
  ArrowUpFromLine,
  CircleAlert,
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
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { GitAction, GitStatus } from "../../shared/git";
import { performGit, refreshGit, useGit, useHost } from "../connection";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type Action = { id: number; kind: GitAction["kind"]; branch?: string; status: GitStatus };

/** The toolbar's controls in the order they appear, most named for their actions. */
const CONTROLS = [
  "branch",
  "create-branch",
  "new-worktree",
  "commit",
  "push",
  "pr",
  "create-pr",
  "refresh",
  "remove-worktree",
] as const;
type Control = (typeof CONTROLS)[number];

/** The mode belongs to the thread. Creating a worktree always starts a new thread. */
export function BranchToolbar() {
  const status = useGit((git) => git.status);
  const error = useGit((git) => git.error);
  const busy = useGit((git) => git.busy);
  const connected = useHost((host) => host.connection === "connected");
  const worktree = useHost((host) => host.thread?.worktree ?? false);
  const cwd = useHost((host) => host.thread?.project);
  const [action, setAction] = useState<Action | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const branchPicker = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState<Control | null>(null);
  const disabled = busy || !connected;
  if (!status?.root)
    return (
      <div className="mt-2 flex items-center gap-1">
        <p className="text-xs text-muted-foreground">
          {error ?? (status ? "Not a Git checkout" : "Reading Git status…")}
        </p>
        {error ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh Git"
            disabled={disabled}
            onClick={refreshGit}
          >
            <RefreshCw aria-hidden />
          </Button>
        ) : null}
        {/* A worktree whose folder was deleted outside Tondo must stay removable. */}
        {worktree ? <RemoveMissingWorktree disabled={disabled} cwd={cwd ?? ""} /> : null}
      </div>
    );
  const open = (kind: Action["kind"], branch?: string) => {
    setAction({
      id: (action?.id ?? 0) + 1,
      kind,
      ...(branch === undefined ? {} : { branch }),
      status,
    });
    setActionOpen(true);
  };
  const branches =
    status.branch && !status.branches.includes(status.branch)
      ? [status.branch, ...status.branches]
      : status.branches;
  const branchItems = branches.map((branch) => ({ value: branch, label: branch }));
  const pr = status.github.pr;
  const inProgress = progressLabel(status);
  // A control that isn't shown counts as disabled.
  const isDisabled: Record<Control, boolean> = {
    branch: disabled,
    "create-branch": disabled,
    "new-worktree": disabled,
    commit:
      disabled ||
      (status.changes === 0 && !status.untrackedHidden) ||
      !status.branch ||
      Boolean(status.conflicts),
    push: disabled || !status.branch || !status.remote,
    pr: !pr,
    "create-pr":
      pr?.state === "OPEN" || disabled || status.github.state !== "ready" || !status.branch,
    refresh: disabled,
    "remove-worktree": !worktree || disabled,
  };
  // WAI-ARIA's toolbar pattern: Tab stops at the toolbar once, on the control
  // focused last or else the first enabled one, and the arrow keys move between
  // the controls (moveFocus).
  const tabStop =
    focused !== null && !isDisabled[focused]
      ? focused
      : CONTROLS.find((control) => !isDisabled[control]);
  const rove = (control: Control) => ({
    tabIndex: control === tabStop ? 0 : -1,
    onFocus: () => setFocused(control),
  });
  return (
    <>
      {/* Each group wraps as a whole, so a narrow footer breaks between groups. A
          group wider than the footer, as beside the Changes panel at the
          minimum window width, wraps inside too. */}
      <div
        role="toolbar"
        aria-label="Git"
        onKeyDown={moveFocus}
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Badge variant="outline">{worktree ? "Worktree" : "Local"}</Badge>
          <Select
            items={branchItems}
            value={status.branch}
            disabled={isDisabled.branch}
            onValueChange={(branch) => {
              // The picker keeps showing the checked-out branch until a switch succeeds.
              if (branch !== null && branch !== status.branch) open("switch", branch);
            }}
          >
            <SelectTrigger
              ref={branchPicker}
              aria-label="Git branch"
              variant="ghost"
              size="xs"
              className="max-w-48"
              {...rove("branch")}
            >
              <GitBranch aria-hidden />
              <SelectValue placeholder="Detached HEAD" />
            </SelectTrigger>
            <SelectContent>
              {branchItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="xs"
            disabled={isDisabled["create-branch"]}
            onClick={() => open("create-branch")}
            {...rove("create-branch")}
          >
            <GitBranchPlus aria-hidden />
            New branch
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={isDisabled["new-worktree"]}
            onClick={() => open("new-worktree")}
            {...rove("new-worktree")}
          >
            <FolderGit2 aria-hidden />
            New worktree
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Badge variant="secondary">{changesLabel(status)}</Badge>
          {inProgress ? <Badge variant="warning">{inProgress}</Badge> : null}
          <Button
            variant="ghost"
            size="xs"
            disabled={isDisabled.commit}
            onClick={() => open("commit")}
            {...rove("commit")}
          >
            <GitCommitHorizontal aria-hidden />
            Commit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={isDisabled.push}
            onClick={() => open("push")}
            {...rove("push")}
          >
            <ArrowUpFromLine aria-hidden />
            Push
          </Button>
          {status.upstream ? (
            <Badge variant="outline" className="max-w-full">
              <span className="truncate">{trackingLabel(status, status.upstream)}</span>
            </Badge>
          ) : null}
          {pr ? (
            <Button
              variant="link"
              size="xs"
              title={pr.title}
              render={<a href={pr.url} target="_blank" rel="noreferrer" />}
              {...rove("pr")}
            >
              <GitPullRequest aria-hidden />
              {`PR #${pr.number} · ${pr.state.toLowerCase()}`}
              <ExternalLink aria-hidden />
            </Button>
          ) : null}
          {pr?.state !== "OPEN" ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={isDisabled["create-pr"]}
              onClick={() => open("create-pr")}
              {...rove("create-pr")}
            >
              <GitPullRequestCreateArrow aria-hidden />
              Create PR
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh Git"
                  disabled={isDisabled.refresh}
                  onClick={refreshGit}
                  {...rove("refresh")}
                />
              }
            >
              <RefreshCw aria-hidden />
            </TooltipTrigger>
            <TooltipContent>Refresh Git</TooltipContent>
          </Tooltip>
          {worktree ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={isDisabled["remove-worktree"]}
              onClick={() => open("remove-worktree")}
              {...rove("remove-worktree")}
            >
              <Trash2 aria-hidden />
              Remove worktree
            </Button>
          ) : null}
        </div>
        {busy ? (
          <span role="status" className="flex items-center gap-1.5 text-xs">
            <Spinner size="xs" />
            Git action running…
          </span>
        ) : null}
      </div>
      {error || status.github.message ? (
        <p className="mt-1 text-xs text-muted-foreground">{error ?? status.github.message}</p>
      ) : null}
      {action ? (
        <ActionDialog
          key={action.id}
          action={action}
          open={actionOpen}
          worktree={worktree}
          cwd={cwd ?? ""}
          finalFocus={action.kind === "switch" ? branchPicker : undefined}
          close={() => setActionOpen(false)}
          closed={() => setAction(null)}
        />
      ) : null}
    </>
  );
}

// Left, Right, Home and End move focus between the toolbar's enabled controls,
// and the control they focus takes the toolbar's one Tab stop.
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("button:enabled, a[href]"),
  ];
  const index = controls.indexOf(event.target as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  const count = controls.length;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? count - 1
        : (index + (event.key === "ArrowRight" ? 1 : count - 1)) % count;
  controls[next]?.focus();
}

function changesLabel({ changes, untrackedHidden }: GitStatus): string {
  if (untrackedHidden) return "Too many untracked files to count";
  if (changes === 0) return "No changes";
  return changes === 1 ? "1 change" : `${changes} changes`;
}

const OPERATIONS: Record<NonNullable<GitStatus["operation"]>, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
};

function progressLabel({ operation, conflicts = 0 }: GitStatus): string | null {
  const running = operation ? `${OPERATIONS[operation]} in progress` : null;
  const unresolved = conflicts ? (conflicts === 1 ? "1 conflict" : `${conflicts} conflicts`) : null;
  if (running && unresolved) return `${running}, ${unresolved}`;
  return running ?? unresolved;
}

function trackingLabel({ ahead, behind }: GitStatus, upstream: string): string {
  if (ahead && behind) return `${ahead} ahead, ${behind} behind ${upstream}`;
  if (ahead) return `${ahead} ahead of ${upstream}`;
  if (behind) return `${behind} behind ${upstream}`;
  return `Up to date with ${upstream}`;
}

const TITLES: Record<GitAction["kind"], string> = {
  switch: "Switch branch",
  "create-branch": "Create branch",
  "new-worktree": "Create worktree thread",
  "remove-worktree": "Remove worktree and forget thread",
  commit: "Stage all and commit",
  push: "Push branch",
  "create-pr": "Create pull request",
};

const FAILURES: Record<GitAction["kind"], string> = {
  switch: "Couldn't switch branch",
  "create-branch": "Couldn't create the branch",
  "new-worktree": "Couldn't create the worktree",
  "remove-worktree": "Couldn't remove the worktree",
  commit: "Couldn't commit",
  push: "Couldn't push",
  "create-pr": "Couldn't create the pull request",
};

function describe({ kind, branch, status }: Action, worktree: boolean): string {
  switch (kind) {
    case "switch":
      return `Switch to ${branch}? ${worktree ? "This changes this worktree." : "All local threads share this checkout."} Conflicting changes will not be discarded.`;
    case "create-branch":
      return "Create and switch from the current HEAD. Local threads share the checkout.";
    case "new-worktree":
      return "Start a new thread in a separate checkout. Uncommitted changes are not copied. This thread stays where it is.";
    case "commit":
      return `Stage all ${status.untrackedHidden ? "" : `${status.changes} `}changed paths in this checkout and commit. This includes untracked files that Git does not ignore. ${status.operation ? `This concludes the ${status.operation} in progress. ` : ""}Git hooks and your signing settings still apply.`;
    case "push":
      return `Push ${status.branch} to ${status.remote} and set its upstream. This publishes committed changes. No force push.`;
    case "create-pr":
      return `Create a pull request for ${status.branch} on ${status.remote}. Push first. This action does not push or merge.`;
    case "remove-worktree":
      return "Delete this checkout and forget its thread in Tondo. The branch and external pi session file stay. Close its terminals first. Removal will refuse dirty or ignored files unless you confirm below.";
  }
}

/** `required` accepts spaces, and the host rejects a blank name or message. */
const BLANK: Record<string, string> = {
  branch: "Enter a branch name.",
  base: "Enter a base branch.",
  title: "Enter a pull request title.",
  message: "Enter a commit message.",
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Removal for a worktree thread whose checkout Git can't read, such as a deleted folder. */
function RemoveMissingWorktree({ disabled, cwd }: { disabled: boolean; cwd: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await performGit({ kind: "remove-worktree", force: false }, null);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setPending(false);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden />
        Remove worktree
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !pending) setOpen(false);
        }}
      >
        <AlertDialogPopup initialFocus={cancel} className="max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{TITLES["remove-worktree"]}</AlertDialogTitle>
              <p className="font-mono text-xs break-all text-muted-foreground">{cwd}</p>
              <AlertDialogDescription>
                Forget this thread in Tondo and clear Git&apos;s record of its checkout if the
                folder is gone. The branch and external pi session file stay. A folder that still
                exists is removed only if it has no uncommitted or ignored files.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertTitle>{FAILURES["remove-worktree"]}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancel} disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size="sm" />
                    Working…
                  </>
                ) : (
                  TITLES["remove-worktree"]
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function ActionDialog({
  action,
  open,
  worktree,
  cwd,
  finalFocus,
  close,
  closed,
}: {
  action: Action;
  open: boolean;
  worktree: boolean;
  cwd: string;
  finalFocus: RefObject<HTMLElement | null> | undefined;
  close: () => void;
  closed: () => void;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const message = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [force, setForce] = useState(false);
  const { kind, status } = action;
  const base =
    kind === "new-worktree"
      ? (status.branch ?? "HEAD")
      : (["main", "master"].find((branch) => status.branches.includes(branch)) ?? "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "");
    const blank = Object.keys(BLANK).find((name) => values.has(name) && !value(name).trim());
    if (blank) {
      setError(BLANK[blank]!);
      return;
    }
    let gitAction: GitAction;
    switch (kind) {
      case "switch":
        gitAction = { kind, branch: action.branch! };
        break;
      case "create-branch":
        gitAction = { kind, branch: value("branch") };
        break;
      case "new-worktree":
        gitAction = { kind, branch: value("branch"), base: value("base") };
        break;
      case "remove-worktree":
        gitAction = { kind, force };
        break;
      case "commit":
        gitAction = { kind, message: value("message") };
        break;
      case "push":
        gitAction = { kind, remote: status.remote! };
        break;
      case "create-pr":
        gitAction = {
          kind,
          remote: status.remote!,
          base: value("base"),
          title: value("title"),
          body: value("body"),
        };
        break;
    }
    setPending(true);
    setError(null);
    try {
      await performGit(gitAction, status.branch);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setPending(false);
  };

  const onOpenChange = (next: boolean) => {
    if (!next && !pending) close();
  };
  // The dialog stays mounted through its exit transition, then goes.
  const onOpenChangeComplete = (isOpen: boolean) => {
    if (!isOpen) closed();
  };
  const initialFocus =
    kind === "commit"
      ? message
      : kind === "create-branch" || kind === "new-worktree" || kind === "create-pr"
        ? field
        : cancel;
  const where = (
    <p className="font-mono text-xs break-all text-muted-foreground">
      {cwd} · {status.branch ?? "Detached HEAD"}
    </p>
  );
  const fields = (
    <>
      {kind === "create-branch" || kind === "new-worktree" ? (
        <Field id={`${id}-branch`} label="Branch name">
          <Input
            ref={field}
            id={`${id}-branch`}
            name="branch"
            required
            maxLength={250}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </Field>
      ) : null}
      {kind === "create-pr" ? (
        <>
          <Field id={`${id}-title`} label="Pull request title">
            <Input
              ref={field}
              id={`${id}-title`}
              name="title"
              required
              maxLength={500}
              disabled={pending}
            />
          </Field>
          <Field id={`${id}-body`} label="Pull request description">
            <Textarea
              id={`${id}-body`}
              name="body"
              maxLength={60_000}
              rows={5}
              disabled={pending}
              className="min-h-24 max-h-48"
            />
          </Field>
        </>
      ) : null}
      {kind === "new-worktree" || kind === "create-pr" ? (
        <Field id={`${id}-base`} label="Base branch">
          <Input
            id={`${id}-base`}
            name="base"
            required
            maxLength={250}
            defaultValue={base}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </Field>
      ) : null}
      {kind === "commit" ? (
        <Field id={`${id}-message`} label="Commit message">
          <Textarea
            ref={message}
            id={`${id}-message`}
            name="message"
            required
            maxLength={10_000}
            rows={3}
            disabled={pending}
            className="max-h-48"
          />
        </Field>
      ) : null}
      {kind === "remove-worktree" ? (
        <div className="flex items-center gap-2 text-destructive">
          <Checkbox
            id={`${id}-force`}
            checked={force}
            onCheckedChange={setForce}
            disabled={pending}
          />
          <Label htmlFor={`${id}-force`}>
            Permanently delete uncommitted and ignored files too
          </Label>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>{FAILURES[kind]}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
  const submitLabel = pending ? (
    <>
      <Spinner size="sm" />
      Working…
    </>
  ) : (
    TITLES[kind]
  );

  if (kind === "switch" || kind === "remove-worktree")
    return (
      <AlertDialog
        open={open}
        onOpenChange={onOpenChange}
        onOpenChangeComplete={onOpenChangeComplete}
      >
        <AlertDialogPopup initialFocus={initialFocus} finalFocus={finalFocus} className="max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{TITLES[kind]}</AlertDialogTitle>
              {where}
              <AlertDialogDescription>{describe(action, worktree)}</AlertDialogDescription>
            </AlertDialogHeader>
            {fields}
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancel} disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant={kind === "remove-worktree" ? "destructive" : "default"}
                disabled={pending}
              >
                {submitLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogPopup>
      </AlertDialog>
    );
  // A press outside would drop what the form holds, so only Escape and the buttons close it.
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
      disablePointerDismissal
    >
      <DialogPopup initialFocus={initialFocus} finalFocus={finalFocus} className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{TITLES[kind]}</DialogTitle>
            {where}
            <DialogDescription>{describe(action, worktree)}</DialogDescription>
          </DialogHeader>
          {fields}
          <DialogFooter>
            <DialogClose ref={cancel} disabled={pending} render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
