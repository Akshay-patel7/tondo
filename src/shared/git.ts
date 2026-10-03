/** Git actions accept names, never shell commands, repository paths or executable paths. */
export type GitAction =
  | { kind: "switch"; branch: string }
  | { kind: "create-branch"; branch: string }
  | { kind: "new-worktree"; branch: string; base: string }
  | { kind: "remove-worktree"; force: boolean }
  | { kind: "commit"; message: string }
  | { kind: "push"; remote: string }
  | { kind: "create-pr"; remote: string; base: string; title: string; body: string };

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
}

export interface GitHubStatus {
  readonly state: "ready" | "missing" | "logged-out" | "unavailable" | "no-remote";
  readonly message: string | null;
  readonly pr: PullRequest | null;
}

export interface GitStatus {
  /** null for a non-repository. All paths are resolved by the host. */
  readonly root: string | null;
  readonly branch: string | null;
  readonly branches: readonly string[];
  readonly changes: number;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly remote: string | null;
  readonly github: GitHubStatus;
}

export type GitCommand =
  | { type: "git-refresh"; threadId: string }
  | {
      type: "git-action";
      threadId: string;
      id: number;
      expectedBranch: string | null;
      action: GitAction;
    };

export type GitEvent =
  | { type: "git-status"; threadId: string; status: GitStatus | null; error: string | null }
  | { type: "git-result"; threadId: string; id: number; error: string | null };

function text(value: unknown, max: number, blank = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    !value.includes("\0") &&
    (blank || value.trim().length > 0)
  );
}

/** Git check-ref-format does the final branch validation in the host. */
export function isGitAction(value: unknown): value is GitAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  let fields: string[];
  switch (action.kind) {
    case "switch":
    case "create-branch":
      if (!text(action.branch, 250)) return false;
      fields = ["kind", "branch"];
      break;
    case "new-worktree":
      if (!text(action.branch, 250) || !text(action.base, 250)) return false;
      fields = ["kind", "branch", "base"];
      break;
    case "remove-worktree":
      if (typeof action.force !== "boolean") return false;
      fields = ["kind", "force"];
      break;
    case "commit":
      if (!text(action.message, 10_000)) return false;
      fields = ["kind", "message"];
      break;
    case "push":
      if (!text(action.remote, 250)) return false;
      fields = ["kind", "remote"];
      break;
    case "create-pr":
      if (
        !text(action.remote, 250) ||
        !text(action.base, 250) ||
        !text(action.title, 500) ||
        !text(action.body, 60_000, true)
      )
        return false;
      fields = ["kind", "remote", "base", "title", "body"];
      break;
    default:
      return false;
  }
  return Object.keys(action).every((key) => fields.includes(key));
}
