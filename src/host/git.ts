// Status and explicit-host PR handling follow T3 Code's vcs/GitVcsDriverCore.ts,
// vcs/VcsStatusBroadcaster.ts and pullRequest/GitHubPullRequestCli.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { existsSync } from "node:fs";
import path from "node:path";
import type { GitAction, GitHubStatus, GitOperation, GitStatus, PullRequest } from "../shared/git";
import { GitCommandError, GitCommands, MISSING_FOLDER } from "./gitCommand";

const NO_GITHUB: GitHubStatus = { state: "no-remote", message: "No GitHub remote.", pr: null };
const EMPTY: GitStatus = {
  root: null,
  branch: null,
  branches: [],
  changes: 0,
  upstream: null,
  ahead: 0,
  behind: 0,
  remote: null,
  github: NO_GITHUB,
  conflicts: 0,
  operation: null,
  untrackedHidden: false,
};

/** What act() reports when an action other than a pull worked. */
const SUCCEEDED = {
  switch: "Changed branch.",
  "create-branch": "Changed branch.",
  commit: "Committed changes.",
  push: "Pushed branch.",
  "create-pr": "Created pull request.",
};

/** The state files Git leaves while an operation waits, most specific first. */
const OPERATIONS: readonly (readonly [string, GitOperation])[] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
];

function statusArgs(untracked: "normal" | "no"): string[] {
  return [
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    `--untracked-files=${untracked}`,
  ];
}

/** Git's own reason, already credential-redacted by GitCommandError, after Tondo's hint. */
function because(hint: string, error: unknown): Error {
  return new Error(error instanceof GitCommandError ? `${hint} ${error.message}` : hint);
}

/** -z keeps newlines, tabs and Git's quoting out of file-name parsing. */
export function parseGitStatus(
  output: string,
): Pick<GitStatus, "branch" | "changes" | "upstream" | "ahead" | "behind" | "conflicts"> {
  let branch: string | null = null;
  let upstream: string | null = null;
  let changes = 0;
  let conflicts = 0;
  let ahead = 0;
  let behind = 0;
  const records = output.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.startsWith("# branch.head ")) {
      const name = record.slice(14);
      branch = name === "(detached)" ? null : name;
    } else if (record.startsWith("# branch.upstream ")) upstream = record.slice(18);
    else if (record.startsWith("# branch.ab ")) {
      const match = /^# branch.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (/^[12u?] /.test(record)) {
      changes++;
      if (record.startsWith("u ")) conflicts++;
      if (record.startsWith("2 ")) i++;
    }
  }
  return { branch, changes, upstream, ahead, behind, conflicts };
}

/** SSH scp syntax, SSH URLs, HTTPS and Enterprise. Never return embedded credentials. */
export function githubRepository(remote: string): { host: string; repo: string } | null {
  let host: string;
  let pathname: string;
  try {
    if (remote.includes("://")) {
      const url = new URL(remote);
      if (!["https:", "http:", "ssh:"].includes(url.protocol)) return null;
      host = url.hostname;
      pathname = url.pathname.slice(1);
    } else {
      const match = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(remote);
      if (!match) return null;
      host = match[1]!;
      pathname = match[2]!;
    }
    const repo = pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    return { host, repo };
  } catch {
    return null;
  }
}

function pullRequest(value: unknown, host: string): PullRequest {
  if (!value || typeof value !== "object") throw new Error("gh returned an invalid pull request.");
  const pr = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(pr.number) ||
    (pr.number as number) < 1 ||
    typeof pr.title !== "string" ||
    typeof pr.url !== "string" ||
    !["OPEN", "CLOSED", "MERGED"].includes(String(pr.state))
  )
    throw new Error("gh returned an invalid pull request.");
  const url = new URL(pr.url);
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password)
    throw new Error("gh returned an unexpected pull request URL.");
  return {
    number: pr.number as number,
    title: pr.title,
    url: url.href,
    state: pr.state as PullRequest["state"],
  };
}

export class Git {
  private readonly remoteCache = new Map<string, { at: number; status: GitHubStatus }>();
  readonly commands: GitCommands;
  constructor(commands: GitCommands) {
    this.commands = commands;
  }

  run(cwd: string, args: readonly string[], input?: string): Promise<string> {
    return this.commands.run("git", cwd, args, input);
  }

  async config(cwd: string, key: string): Promise<string | null> {
    try {
      return (await this.run(cwd, ["config", "--get", key])).trim() || null;
    } catch (error) {
      if (error instanceof GitCommandError && error.code === 1) return null;
      throw error;
    }
  }

  async branchName(cwd: string, branch: string): Promise<void> {
    if (branch.startsWith("-") || branch.includes("@{") || branch === "HEAD")
      throw new Error("Choose a literal branch name, not an option or revision expression.");
    await this.run(cwd, ["check-ref-format", "--branch", branch]);
  }

  async status(cwd: string, remote = true, fresh = false): Promise<GitStatus> {
    let root: string;
    try {
      root = (await this.run(cwd, ["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
    } catch (error) {
      if (error instanceof GitCommandError && error.detail.includes("not a git repository"))
        return EMPTY;
      throw error;
    }
    const [{ porcelain, untrackedHidden }, refs, names, gitPaths] = await Promise.all([
      this.porcelain(cwd),
      this.run(cwd, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]),
      this.run(cwd, ["remote"]),
      this.run(cwd, ["rev-parse", ...OPERATIONS.flatMap(([file]) => ["--git-path", file])]),
    ]);
    const state = parseGitStatus(porcelain);
    const found = gitPaths
      .split("\n")
      .findIndex((file, index) => index < OPERATIONS.length && existsSync(path.resolve(cwd, file)));
    const operation = found === -1 ? null : OPERATIONS[found]![1];
    const remotes = names.trim().split("\n").filter(Boolean);
    const preferred =
      (state.branch && (await this.config(cwd, `branch.${state.branch}.pushRemote`))) ||
      (await this.config(cwd, "remote.pushDefault")) ||
      (state.branch && (await this.config(cwd, `branch.${state.branch}.remote`)));
    let chosen: string | null = null;
    if (preferred && remotes.includes(preferred)) chosen = preferred;
    else if (remotes.includes("origin")) chosen = "origin";
    else if (remotes.length === 1) chosen = remotes[0]!;
    const github =
      remote && chosen && state.branch
        ? await this.githubStatus(cwd, chosen, state.branch, fresh)
        : NO_GITHUB;
    return {
      ...state,
      root,
      branches: refs.trim().split("\n").filter(Boolean),
      remote: chosen,
      github,
      operation,
      untrackedHidden,
    };
  }

  /** A huge untracked tree must not take the toolbar down, so list tracked paths only then. */
  private async porcelain(cwd: string): Promise<{ porcelain: string; untrackedHidden: boolean }> {
    try {
      return { porcelain: await this.run(cwd, statusArgs("normal")), untrackedHidden: false };
    } catch (error) {
      if (!(error instanceof GitCommandError && error.detail === "output exceeded 4 MiB"))
        throw error;
      return { porcelain: await this.run(cwd, statusArgs("no")), untrackedHidden: true };
    }
  }

  private async repository(cwd: string, remote: string) {
    // Read the configured URL, not get-url's insteadOf rewrite. Git still uses its rewrite when pushing.
    const url = await this.config(cwd, `remote.${remote}.url`);
    return url ? githubRepository(url) : null;
  }

  private async githubStatus(
    cwd: string,
    remote: string,
    branch: string,
    fresh: boolean,
  ): Promise<GitHubStatus> {
    const repo = await this.repository(cwd, remote);
    if (!repo) return NO_GITHUB;
    const key = `${cwd}\0${remote}\0${branch}\0${repo.host}/${repo.repo}`;
    const cached = this.remoteCache.get(key);
    if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.status;
    let status: GitHubStatus;
    try {
      await this.commands.run("gh", cwd, ["auth", "status", "--active", "--hostname", repo.host]);
    } catch (error) {
      // A missing project folder isn't a missing gh or a sign-in problem.
      if (error instanceof GitCommandError && error.code === MISSING_FOLDER) throw error;
      const missing = error instanceof GitCommandError && error.code === "ENOENT";
      status = {
        state: missing ? "missing" : "logged-out",
        message: missing
          ? "Install GitHub CLI (gh) to use pull requests."
          : `Sign in with gh auth login --hostname ${repo.host}, then refresh.`,
        pr: null,
      };
      this.cache(key, status);
      return status;
    }
    try {
      const output = await this.commands.run("gh", cwd, [
        "pr",
        "list",
        "--repo",
        `${repo.host}/${repo.repo}`,
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "number,title,url,state",
      ]);
      const prs: unknown = JSON.parse(output);
      if (!Array.isArray(prs)) throw new Error("gh returned an invalid pull request list.");
      status = {
        state: "ready",
        message: null,
        pr: prs.length ? pullRequest(prs[0], repo.host) : null,
      };
    } catch {
      status = {
        state: "unavailable",
        message: `Could not read pull requests from ${repo.host}. Check network access and repository permissions.`,
        pr: null,
      };
    }
    this.cache(key, status);
    return status;
  }

  private cache(key: string, status: GitHubStatus): void {
    // Only the visible checkout polls. Bound old thread/branch entries as well.
    if (this.remoteCache.size >= 32) this.remoteCache.clear();
    this.remoteCache.set(key, { at: Date.now(), status });
  }

  /** Runs `action` and returns what it did, for a toast. */
  async act(
    cwd: string,
    action: Exclude<GitAction, { kind: "new-worktree" | "remove-worktree" }>,
    expectedBranch: string | null,
  ): Promise<string> {
    const status = await this.status(cwd, false);
    if (!status.root) throw new Error("This folder is not a Git checkout.");
    if (status.branch !== expectedBranch)
      throw new Error("The branch changed. Review the current branch and try again.");
    if (action.kind === "pull") return this.pull(cwd, status);
    switch (action.kind) {
      case "switch":
        await this.branchName(cwd, action.branch);
        await this.run(cwd, ["switch", "--", action.branch]);
        break;
      case "create-branch":
        await this.branchName(cwd, action.branch);
        if (action.base !== "HEAD") await this.branchName(cwd, action.base);
        // Omit the start point for the current checkout, including an unborn branch.
        await this.run(cwd, [
          "switch",
          "-c",
          action.branch,
          ...(action.base === "HEAD" || action.base === status.branch
            ? []
            : ["--", `refs/heads/${action.base}`]),
        ]);
        break;
      case "commit":
        if (!status.branch) throw new Error("Create or switch to a branch before committing.");
        if (status.conflicts)
          throw new Error(
            `${status.conflicts === 1 ? "1 path has" : `${status.conflicts} paths have`} unresolved conflicts${status.operation ? ` from the ${status.operation} in progress` : ""}. Resolve them and mark them resolved with git add, or abort the ${status.operation ?? "operation"}, before committing.`,
          );
        if (status.changes === 0 && !status.untrackedHidden)
          throw new Error("There are no changes to commit.");
        await this.run(status.root, ["add", "--all", "--", "."]);
        await this.run(status.root, ["commit", "--file=-"], action.message);
        break;
      case "push":
      case "create-pr": {
        if (!status.branch || action.remote !== status.remote)
          throw new Error("The branch or remote changed. Refresh and review the target.");
        if (action.kind === "push") {
          try {
            await this.run(cwd, [
              "push",
              "--set-upstream",
              "--",
              action.remote,
              `HEAD:refs/heads/${status.branch}`,
            ]);
          } catch (error) {
            throw because(
              "Push failed. Check remote access, signing and whether the remote has newer commits. Tondo never force-pushes.",
              error,
            );
          }
          break;
        }
        await this.branchName(cwd, action.base);
        if (action.base === status.branch)
          throw new Error("The pull request base must differ from this branch.");
        const repo = await this.repository(cwd, action.remote);
        if (!repo) throw new Error("Choose a GitHub remote before creating a pull request.");
        const gh = await this.githubStatus(cwd, action.remote, status.branch, true);
        if (gh.state !== "ready") throw new Error(gh.message ?? "GitHub CLI is unavailable.");
        if (gh.pr?.state === "OPEN")
          throw new Error("This branch already has an open pull request.");
        const head = (await this.run(cwd, ["rev-parse", "HEAD"])).trim();
        let remoteHead: string;
        try {
          remoteHead = await this.run(cwd, [
            "ls-remote",
            "--heads",
            "--",
            action.remote,
            `refs/heads/${status.branch}`,
          ]);
        } catch {
          throw new Error(
            "Could not check the remote branch. Check remote access before creating a pull request.",
          );
        }
        if (remoteHead.split(/\s/)[0] !== head)
          throw new Error(
            "Push this branch first. Creating a pull request will not push commits for you.",
          );
        try {
          await this.commands.run(
            "gh",
            cwd,
            [
              "pr",
              "create",
              "--repo",
              `${repo.host}/${repo.repo}`,
              "--head",
              status.branch,
              "--base",
              action.base,
              "--title",
              action.title,
              "--body-file",
              "-",
            ],
            action.body,
          );
        } catch (error) {
          throw because(
            "GitHub CLI could not create the pull request. Refresh to check whether it was created before retrying.",
            error,
          );
        }
        break;
      }
    }
    this.remoteCache.clear();
    return SUCCEEDED[action.kind];
  }

  /**
   * Fetches the branch's upstream and fast-forwards to it. Git leaves the
   * branch and its files alone when the branch has diverged from its
   * upstream, or when the update would overwrite uncommitted changes.
   */
  private async pull(cwd: string, { branch, upstream }: GitStatus): Promise<string> {
    if (!branch) throw new Error("Switch to a branch before pulling.");
    if (!upstream) throw new Error(`${branch} has no upstream to pull from. Push it to set one.`);
    const before = await this.head(cwd);
    try {
      // --no-rebase merges whatever pull.rebase says, and --ff-only allows only a fast-forward
      // merge. --quiet and the advice setting leave just Git's reason when it refuses.
      await this.run(cwd, [
        "-c",
        "advice.diverging=false",
        "pull",
        "--quiet",
        "--ff-only",
        "--no-rebase",
      ]);
    } catch (error) {
      throw because(
        "Pull failed. Check remote access and whether uncommitted changes are in the way. Tondo only fast-forwards, so merge or rebase a diverged branch yourself.",
        error,
      );
    }
    return (await this.head(cwd)) === before
      ? `Already up to date with ${upstream}.`
      : `Pulled ${upstream} into ${branch}.`;
  }

  /** The commit HEAD names, or "" on a branch with no commits yet, as in a clone of an empty repository. */
  private async head(cwd: string): Promise<string> {
    try {
      return (await this.run(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim();
    } catch (error) {
      if (error instanceof GitCommandError && error.code === 1) return "";
      throw error;
    }
  }
}
