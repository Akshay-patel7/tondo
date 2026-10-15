// The confirmations behind the header's Git menu. Each action asks in a
// dialog before the host runs it, and shows the host's refusal in place.
import { CircleAlert } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GitAction, GitStatus } from "../../shared/git";
import { performGit, useGit } from "../connection";
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
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { BranchPicker } from "./BranchPicker";
import { FAILURES, TITLES } from "./labels";

/** A Git action waiting for its dialog, with the status it was opened on. `next` chains a push after a commit. */
export interface Action {
  readonly id: number;
  readonly kind: GitAction["kind"];
  readonly status: GitStatus;
  readonly next?: "push";
}

/** Where focus goes when a dialog closes: the control that opened it. */
export type FinalFocus = () => HTMLElement | null;

/** `required` accepts spaces, and the host rejects a blank name or message. */
const BLANK: Record<string, string> = {
  branch: "Enter a branch name.",
  base: "Enter a base branch.",
  title: "Enter a pull request title.",
  message: "Enter a commit message.",
};

function describe({ kind, status }: Action, worktree: boolean, branch: string): string {
  switch (kind) {
    case "switch":
      return `Switch to ${branch || "another branch"}? ${worktree ? "This changes this worktree." : "All local threads share this checkout."} Conflicting changes will not be discarded.`;
    case "create-branch":
      return `Create and switch from the selected parent branch. ${worktree ? "This changes this worktree." : "Local threads share the checkout."} Conflicting changes will not be discarded.`;
    case "new-worktree":
      return "Start a new thread in a separate checkout. Uncommitted changes are not copied. This thread stays where it is.";
    case "commit":
      return `Stage all ${status.untrackedHidden ? "" : `${status.changes} `}changed paths in this checkout and commit. This includes untracked files that Git does not ignore. ${status.operation ? `This concludes the ${status.operation} in progress. ` : ""}Git hooks and your signing settings still apply.`;
    case "push":
      return `Push ${status.branch} to ${status.remote} and set its upstream. This publishes committed changes. No force push.`;
    case "pull":
      return `Fetch ${status.upstream} and fast-forward ${status.branch} to it. If ${status.branch} has diverged, or uncommitted changes are in the way, Git stops before your branch or files change. No merge or rebase.`;
    case "create-pr":
      return `Create a pull request for ${status.branch} on ${status.remote}. Push first. This action does not push or merge.`;
    case "remove-worktree":
      return "Delete this checkout. The branch and thread stay, so you can delete its pi session separately with Delete thread. Close its terminals first. Removal will refuse dirty or ignored files unless you confirm below.";
  }
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Removal for a worktree thread whose checkout Git can't read, such as a deleted folder. */
export function RemoveMissingWorktreeDialog({
  open,
  cwd,
  finalFocus,
  close,
}: {
  open: boolean;
  cwd: string;
  finalFocus: FinalFocus;
  close: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await performGit({ kind: "remove-worktree", force: false }, null);
      close();
    } catch (cause) {
      setError(failure(cause));
    }
    setPending(false);
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <AlertDialogPopup initialFocus={cancel} finalFocus={finalFocus} className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{TITLES["remove-worktree"]}</AlertDialogTitle>
            <p className="font-mono text-xs break-all text-muted-foreground">{cwd}</p>
            <AlertDialogDescription>
              Clear Git&apos;s record of this checkout if the folder is gone. The branch and thread
              stay, so you can delete its pi session separately with Delete thread. A folder that
              still exists is removed only if it has no uncommitted or ignored files.
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
  );
}

/**
 * The dialog for `action`. `close(true)` means the host ran the action, and
 * `closed` follows once the dialog has left the screen.
 */
export function ActionDialog({
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
  finalFocus: FinalFocus;
  close: (done: boolean) => void;
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
  // The branch to switch to. The list follows refreshes, so a branch made
  // while the dialog is open shows once Git is read again.
  const [branch, setBranch] = useState(status.branch ?? "");
  const branches = useGit((git) => git.status?.branches ?? status.branches);
  const [base, setBase] = useState(status.branch ?? "HEAD");
  const baseBranches = status.branch === null ? ["HEAD", ...branches] : branches;
  const prBase = ["main", "master"].find((name) => status.branches.includes(name)) ?? "";

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
        gitAction = { kind, branch };
        break;
      case "create-branch":
      case "new-worktree":
        gitAction = { kind, branch: value("branch"), base };
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
      case "pull":
        gitAction = { kind };
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
      close(true);
    } catch (cause) {
      setError(failure(cause));
    }
    setPending(false);
  };

  const onOpenChange = (next: boolean) => {
    if (!next && !pending) close(false);
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
      {kind === "switch" ? (
        <Field id={`${id}-switch`} label="Branch">
          <BranchPicker
            id={`${id}-switch`}
            label="Git branch"
            branches={branches}
            value={branch}
            disabled={pending}
            onValueChange={setBranch}
          />
        </Field>
      ) : null}
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
      {kind === "create-branch" || kind === "new-worktree" ? (
        <Field id={`${id}-base`} label={kind === "create-branch" ? "Parent branch" : "Base branch"}>
          <BranchPicker
            id={`${id}-base`}
            label={kind === "create-branch" ? "Parent branch" : "Base branch"}
            name="base"
            branches={baseBranches}
            value={base}
            disabled={pending}
            onValueChange={setBase}
          />
        </Field>
      ) : null}
      {kind === "create-pr" ? (
        <Field id={`${id}-base`} label="Base branch">
          <Input
            id={`${id}-base`}
            name="base"
            required
            maxLength={250}
            defaultValue={prBase}
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
  // The checked-out branch is no switch, so the picker has to move first.
  const submitDisabled = pending || (kind === "switch" && (!branch || branch === status.branch));

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
              <AlertDialogDescription>{describe(action, worktree, branch)}</AlertDialogDescription>
            </AlertDialogHeader>
            {fields}
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancel} disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant={kind === "remove-worktree" ? "destructive" : "default"}
                disabled={submitDisabled}
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
            <DialogDescription>{describe(action, worktree, branch)}</DialogDescription>
          </DialogHeader>
          {fields}
          <DialogFooter>
            <DialogClose ref={cancel} disabled={pending} render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
