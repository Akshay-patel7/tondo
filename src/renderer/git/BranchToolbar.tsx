import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GitAction, GitStatus } from "../../shared/git";
import { performGit, refreshGit, useGit, useHost } from "../connection";

type Dialog = { kind: GitAction["kind"]; branch?: string; status: GitStatus };
const BUTTON =
  "rounded-control px-2 py-1 hover:bg-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring";
const INPUT = "mt-1 w-full rounded-control border border-border bg-background px-2 py-1.5 text-sm";

/** The mode belongs to the thread. Creating a worktree always starts a new thread. */
export function BranchToolbar() {
  const status = useGit((git) => git.status);
  const error = useGit((git) => git.error);
  const busy = useGit((git) => git.busy);
  const connected = useHost((host) => host.connection === "connected");
  const worktree = useHost((host) => host.thread?.worktree ?? false);
  const cwd = useHost((host) => host.thread?.project);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (!status?.root)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {error ?? (status ? "Not a Git checkout" : "Reading Git status…")}
      </p>
    );
  const disabled = busy || !connected;
  const open = (kind: Dialog["kind"], branch?: string) =>
    setDialog({ kind, ...(branch === undefined ? {} : { branch }), status });
  return (
    <>
      <div
        role="toolbar"
        aria-label="Git"
        className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <span title={cwd} className="mr-1">
          {worktree ? "Worktree" : "Local"}
        </span>
        <select
          aria-label="Git branch"
          value={status.branch ?? ""}
          disabled={disabled}
          onChange={(event) => open("switch", event.target.value)}
          className="max-w-36 rounded-control bg-background px-1 py-1 text-foreground"
        >
          {status.branch === null ? <option value="">Detached HEAD</option> : null}
          {status.branch && !status.branches.includes(status.branch) ? (
            <option>{status.branch}</option>
          ) : null}
          {status.branches.map((branch) => (
            <option key={branch}>{branch}</option>
          ))}
        </select>
        <button className={BUTTON} disabled={disabled} onClick={() => open("create-branch")}>
          New branch
        </button>
        <button className={BUTTON} disabled={disabled} onClick={() => open("new-worktree")}>
          New worktree
        </button>
        <span aria-label="Git changes">{status.changes} changed</span>
        <button
          className={BUTTON}
          disabled={disabled || status.changes === 0 || !status.branch}
          onClick={() => open("commit")}
        >
          Commit
        </button>
        <button
          className={BUTTON}
          disabled={disabled || !status.branch || !status.remote}
          onClick={() => open("push")}
        >
          Push
        </button>
        {status.github.pr ? (
          <a
            className={BUTTON}
            href={status.github.pr.url}
            target="_blank"
            rel="noreferrer"
            title={status.github.pr.title}
          >
            PR #{status.github.pr.number} · {status.github.pr.state.toLowerCase()}
          </a>
        ) : null}
        {status.github.pr?.state !== "OPEN" ? (
          <button
            className={BUTTON}
            disabled={disabled || status.github.state !== "ready" || !status.branch}
            onClick={() => open("create-pr")}
          >
            Create PR
          </button>
        ) : null}
        <button
          className={BUTTON}
          disabled={disabled}
          onClick={refreshGit}
          aria-label="Refresh Git"
        >
          Refresh
        </button>
        {worktree ? (
          <button
            className={`${BUTTON} text-destructive`}
            disabled={disabled}
            onClick={() => open("remove-worktree")}
          >
            Remove worktree
          </button>
        ) : null}
        {status.upstream ? (
          <span title={status.upstream}>
            {status.ahead} ahead · {status.behind} behind
          </span>
        ) : null}
        {busy ? <span role="status">Git action running…</span> : null}
      </div>
      {error || status.github.message ? (
        <p className="mt-1 text-xs text-muted-foreground">{error ?? status.github.message}</p>
      ) : null}
      {dialog ? (
        <ActionDialog
          dialog={dialog}
          worktree={worktree}
          cwd={cwd ?? ""}
          close={() => setDialog(null)}
        />
      ) : null}
    </>
  );
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
    </label>
  );
}

function ActionDialog({
  dialog,
  worktree,
  cwd,
  close,
}: {
  dialog: Dialog;
  worktree: boolean;
  cwd: string;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { kind, status } = dialog;
  const base =
    kind === "new-worktree"
      ? (status.branch ?? "HEAD")
      : (["main", "master"].find((branch) => status.branches.includes(branch)) ?? "");
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showModal();
    return () => element.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "");
    let action: GitAction;
    switch (kind) {
      case "switch":
        action = { kind, branch: dialog.branch! };
        break;
      case "create-branch":
        action = { kind, branch: value("branch") };
        break;
      case "new-worktree":
        action = { kind, branch: value("branch"), base: value("base") };
        break;
      case "remove-worktree":
        action = { kind, force: values.get("force") === "on" };
        break;
      case "commit":
        action = { kind, message: value("message") };
        break;
      case "push":
        action = { kind, remote: status.remote! };
        break;
      case "create-pr":
        action = {
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
      await performGit(action, status.branch);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setPending(false);
  };

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) close();
      }}
      className="app-no-drag m-auto max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] overflow-auto rounded-panel border border-border bg-card p-5 text-foreground shadow-composer backdrop:bg-black/30"
    >
      <form onSubmit={submit}>
        <h2 id={title} className="mb-3 text-base font-medium">
          {TITLES[kind]}
        </h2>
        <p className="mb-3 break-all text-xs text-muted-foreground">
          {cwd} · {status.branch ?? "Detached HEAD"}
        </p>
        <fieldset disabled={pending} className="space-y-3">
          {kind === "switch" ? (
            <p className="text-sm">
              Switch to {dialog.branch}?{" "}
              {worktree ? "This changes this worktree." : "All local threads share this checkout."}{" "}
              Conflicting changes will not be discarded.
            </p>
          ) : null}
          {kind === "create-branch" || kind === "new-worktree" ? (
            <Field label="Branch name">
              <input name="branch" required maxLength={250} className={INPUT} />
            </Field>
          ) : null}
          {kind === "create-branch" ? (
            <p className="text-sm">
              Create and switch from the current HEAD. Local threads share the checkout.
            </p>
          ) : null}
          {kind === "new-worktree" || kind === "create-pr" ? (
            <Field label="Base branch">
              <input name="base" required maxLength={250} defaultValue={base} className={INPUT} />
            </Field>
          ) : null}
          {kind === "new-worktree" ? (
            <p className="text-sm">
              Start a new thread in a separate checkout. Uncommitted changes are not copied. This
              thread stays where it is.
            </p>
          ) : null}
          {kind === "commit" ? (
            <>
              <p className="text-sm">
                Stage all {status.changes} changed paths in this checkout and commit. This includes
                untracked files that Git does not ignore. Git hooks and your signing settings still
                apply.
              </p>
              <Field label="Commit message">
                <textarea name="message" required maxLength={10_000} rows={3} className={INPUT} />
              </Field>
            </>
          ) : null}
          {kind === "push" ? (
            <p className="text-sm">
              Push {status.branch} to {status.remote} and set its upstream. This publishes committed
              changes. No force push.
            </p>
          ) : null}
          {kind === "create-pr" ? (
            <>
              <p className="text-sm">
                Create a pull request for {status.branch} on {status.remote}. Push first. This
                action does not push or merge.
              </p>
              <Field label="Pull request title">
                <input name="title" required maxLength={500} className={INPUT} />
              </Field>
              <Field label="Pull request description">
                <textarea name="body" maxLength={60_000} rows={5} className={INPUT} />
              </Field>
            </>
          ) : null}
          {kind === "remove-worktree" ? (
            <>
              <p className="text-sm">
                Delete this checkout and forget its thread in Tondo. The branch and external pi
                session file stay. Close its terminals first. Removal will refuse dirty or ignored
                files unless you confirm below.
              </p>
              <label className="flex items-start gap-2 text-sm text-destructive">
                <input name="force" type="checkbox" className="mt-1" />
                Permanently delete uncommitted and ignored files too
              </label>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={close}>
              Cancel
            </button>
            <button type="submit" className={`${BUTTON} bg-primary text-primary-foreground`}>
              {pending ? "Working…" : TITLES[kind]}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>,
    document.body,
  );
}
