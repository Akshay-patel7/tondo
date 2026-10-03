// Status and explicit-host PR handling follow T3 Code's vcs/GitVcsDriverCore.ts,
// vcs/VcsStatusBroadcaster.ts and pullRequest/GitHubPullRequestCli.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { GitAction, GitHubStatus, GitStatus, PullRequest } from "../shared/git";
import { GitCommandError, GitCommands } from "./gitCommand";

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
};

/** -z keeps newlines, tabs and Git's quoting out of file-name parsing. */
export function parseGitStatus(
  output: string,
): Pick<GitStatus, "branch" | "changes" | "upstream" | "ahead" | "behind"> {
  let branch: string | null = null;
  let upstream: string | null = null;
  let changes = 0;
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
      if (record.startsWith("2 ")) i++;
    }
  }
  return { branch, changes, upstream, ahead, behind };
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
    const [porcelain, refs, names] = await Promise.all([
      this.run(cwd, [
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
      ]),
      this.run(cwd, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]),
      this.run(cwd, ["remote"]),
    ]);
    const state = parseGitStatus(porcelain);
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
    };
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

  async act(
    cwd: string,
    action: Exclude<GitAction, { kind: "new-worktree" | "remove-worktree" }>,
    expectedBranch: string | null,
  ): Promise<void> {
    const status = await this.status(cwd, false);
    if (!status.root) throw new Error("This folder is not a Git checkout.");
    if (status.branch !== expectedBranch)
      throw new Error("The branch changed. Review the current branch and try again.");
    switch (action.kind) {
      case "switch":
        await this.branchName(cwd, action.branch);
        await this.run(cwd, ["switch", "--", action.branch]);
        break;
      case "create-branch":
        await this.branchName(cwd, action.branch);
        await this.run(cwd, ["switch", "-c", action.branch]);
        break;
      case "commit":
        if (!status.branch) throw new Error("Create or switch to a branch before committing.");
        if (status.changes === 0) throw new Error("There are no changes to commit.");
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
          } catch {
            throw new Error(
              "Push failed. Check remote access, signing and whether the remote has newer commits. Tondo never force-pushes.",
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
        } catch {
          throw new Error(
            "GitHub CLI could not create the pull request. Refresh to check whether it was created before retrying.",
          );
        }
        break;
      }
    }
    this.remoteCache.clear();
  }
}
