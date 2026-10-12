// The words for a checkout's Git state, shared by the header's Git menu, its
// dialogs and the status row's Git pill.
import type { GitAction, GitStatus } from "../../shared/git";

export function changesLabel({ changes, untrackedHidden }: GitStatus): string {
  if (untrackedHidden) return "Too many untracked files to count";
  if (changes === 0) return "No changes";
  return changes === 1 ? "1 change" : `${changes} changes`;
}

export function uncommittedLabel({ changes, untrackedHidden }: GitStatus): string {
  if (untrackedHidden)
    return `${changes} uncommitted tracked ${changes === 1 ? "change" : "changes"}. Untracked files were too many to count.`;
  if (changes === 0) return "No uncommitted changes";
  return `${changes} uncommitted ${changes === 1 ? "change" : "changes"}`;
}

const OPERATIONS: Record<NonNullable<GitStatus["operation"]>, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
};

/** "Merge in progress, 2 conflicts", or null when Git stopped nowhere. */
export function progressLabel({ operation, conflicts = 0 }: GitStatus): string | null {
  const running = operation ? `${OPERATIONS[operation]} in progress` : null;
  const unresolved = conflicts ? (conflicts === 1 ? "1 conflict" : `${conflicts} conflicts`) : null;
  if (running && unresolved) return `${running}, ${unresolved}`;
  return running ?? unresolved;
}

export function trackingLabel({ ahead, behind }: GitStatus, upstream: string): string {
  if (ahead && behind) return `${ahead} ahead, ${behind} behind ${upstream}`;
  if (ahead) return `${ahead} ahead of ${upstream}`;
  if (behind) return `${behind} behind ${upstream}`;
  return `Up to date with ${upstream}`;
}

export const TITLES: Record<GitAction["kind"], string> = {
  switch: "Switch branch",
  "create-branch": "Create branch",
  "new-worktree": "Create worktree thread",
  "remove-worktree": "Remove worktree",
  commit: "Stage all and commit",
  push: "Push branch",
  pull: "Pull branch",
  "create-pr": "Create pull request",
};

export const FAILURES: Record<GitAction["kind"], string> = {
  switch: "Couldn't switch branch",
  "create-branch": "Couldn't create the branch",
  "new-worktree": "Couldn't create the worktree",
  "remove-worktree": "Couldn't remove the worktree",
  commit: "Couldn't commit",
  push: "Couldn't push",
  pull: "Couldn't pull",
  "create-pr": "Couldn't create the pull request",
};
