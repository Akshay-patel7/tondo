// Conservative cleanup checks follow T3 Code's apps/server/src/storageCleanup.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Git } from "./git";
import type { Store, StoredWorktree } from "./store";

export class Worktrees {
  private readonly root: string;
  private readonly store: Store;
  private readonly git: Git;
  constructor(root: string, store: Store, git: Git) {
    this.root = root;
    this.store = store;
    this.git = git;
  }

  forThread(id: string): StoredWorktree | undefined {
    return this.store.worktrees().find((worktree) => worktree.threadId === id);
  }

  async create(
    repository: string,
    threadId: string,
    branch: string,
    base: string,
  ): Promise<StoredWorktree> {
    await this.git.branchName(repository, branch);
    const commit = (
      await this.git.run(repository, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${base}^{commit}`,
      ])
    ).trim();
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    if (!/^[\da-f-]{36}$/.test(threadId)) throw new Error("Invalid worktree owner.");
    const worktree = { path: path.join(root, threadId), repository, branch, threadId };
    // Reserve ownership before Git creates a folder. A crash leaves a recoverable orphan.
    this.store.addWorktree(worktree);
    await this.git.run(repository, ["worktree", "add", "-b", branch, "--", worktree.path, commit]);
    return worktree;
  }

  private async validate(worktree: StoredWorktree): Promise<void> {
    const root = await realpath(this.root);
    if (this.store.projects().some((project) => inside(worktree.path, project.path)))
      throw new Error("A project still uses this worktree. Remove that project from Tondo first.");
    if (
      path.dirname(worktree.path) !== root ||
      path.basename(worktree.path) !== worktree.threadId ||
      (await realpath(worktree.path)) !== worktree.path ||
      !(await lstat(path.join(worktree.path, ".git"))).isFile()
    ) {
      throw new Error("Refusing to remove a folder that is not Tondo's managed linked worktree.");
    }
    const common = (cwd: string) =>
      this.git.run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const [actual, expected, top] = await Promise.all([
      common(worktree.path),
      common(worktree.repository),
      this.git.run(worktree.path, ["rev-parse", "--show-toplevel"]),
    ]);
    if (actual !== expected || top.replace(/\n$/, "") !== worktree.path)
      throw new Error("The worktree no longer belongs to the expected repository.");
  }

  async checkRemoval(worktree: StoredWorktree, force: boolean): Promise<void> {
    await this.validate(worktree);
    if (!force && (await this.git.status(worktree.path, false)).changes > 0)
      throw new Error(
        "The worktree has uncommitted changes. Commit them or explicitly confirm permanent removal.",
      );
    // Git ignores ignored files when deciding whether removal is safe. Tondo does not.
    const ignored = await this.git.run(worktree.path, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
    ]);
    if (ignored && !force)
      throw new Error(
        "The worktree contains ignored files. Confirm permanent removal of all local files to remove it.",
      );
  }

  async remove(worktree: StoredWorktree, force: boolean): Promise<void> {
    await this.checkRemoval(worktree, force);
    // Prune first: a later prune failure must not report a successful removal as failed.
    await this.git.run(worktree.repository, ["worktree", "prune"]);
    await this.git.run(worktree.repository, [
      "worktree",
      "remove",
      ...(force ? ["--force"] : []),
      "--",
      worktree.path,
    ]);
    this.store.forgetWorktree(worktree.path);
  }

  /** Only orphaned ledger entries, never arbitrary directories or archived threads. */
  async cleanup(report: (message: string) => void): Promise<void> {
    for (const worktree of this.store.worktrees()) {
      if (this.store.thread(worktree.threadId)) continue;
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- validate and remove one owned folder at a time.
        await this.cleanupOne(worktree);
      } catch (error) {
        report(
          `Kept abandoned worktree ${worktree.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async cleanupOne(worktree: StoredWorktree): Promise<void> {
    try {
      await lstat(worktree.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing folder may still have Git registration. Let Git remove that entry by path.
      const listing = await this.git.run(worktree.repository, [
        "worktree",
        "list",
        "--porcelain",
        "-z",
      ]);
      if (listing.split("\0").includes(`worktree ${worktree.path}`)) {
        await this.git.run(worktree.repository, ["worktree", "remove", "--", worktree.path]);
        await this.git.run(worktree.repository, ["worktree", "prune"]);
      }
      this.store.forgetWorktree(worktree.path);
      return;
    }
    await this.validate(worktree);
    const state = await this.git.status(worktree.path, false);
    if (state.changes || state.branch !== worktree.branch)
      throw new Error("It has changes or its branch changed.");
    await this.remove(worktree, false);
  }
}

export function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
