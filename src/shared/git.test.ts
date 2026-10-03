import { expect, it } from "vitest";
import { isGitAction, type GitAction } from "./git";
import { parseClientMessage, PROTOCOL_VERSION as v } from "./protocol";

it("accepts only bounded literal Git actions and exact request fields", () => {
  const actions: GitAction[] = [
    { kind: "switch", branch: "main" },
    { kind: "create-branch", branch: "feature" },
    { kind: "new-worktree", branch: "feature", base: "main" },
    { kind: "remove-worktree", force: false },
    { kind: "commit", message: "fix: issue" },
    { kind: "push", remote: "origin" },
    { kind: "create-pr", remote: "origin", base: "main", title: "Fix", body: "" },
  ];
  for (const action of actions) {
    const message = {
      v,
      type: "git-action",
      threadId: "thread",
      id: 1,
      expectedBranch: "main",
      action,
    };
    expect(parseClientMessage(message)).toEqual({ ok: true, message });
    expect(isGitAction({ ...action, cwd: "/another/repo" })).toBe(false);
    expect(parseClientMessage({ ...message, command: "rm" }).ok).toBe(false);
  }
  expect(parseClientMessage({ v, type: "git-refresh", threadId: "thread" }).ok).toBe(true);
});

it("rejects malformed actions and identities before they cross into the host", () => {
  for (const action of [
    null,
    [],
    {},
    { kind: "push", remote: "" },
    { kind: "commit", message: "a\0b" },
    { kind: "remove-worktree", force: "yes" },
    { kind: "switch", branch: "a".repeat(251) },
    { kind: "create-pr", remote: "origin", base: "main", title: "x", body: false },
  ])
    expect(isGitAction(action)).toBe(false);
  for (const id of [-1, NaN, Infinity, "1"])
    expect(
      parseClientMessage({
        v,
        type: "git-action",
        threadId: "thread",
        id,
        expectedBranch: null,
        action: { kind: "push", remote: "origin" },
      }).ok,
    ).toBe(false);
});
