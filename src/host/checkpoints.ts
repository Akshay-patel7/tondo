// Hidden-ref checkpoints and sparse-index handling adapted from T3 Code's
// apps/server/src/vcs/GitVcsDriver.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type { CheckpointFile } from "../shared/checkpoints";
import { drainGroup, signalGroup } from "./processGroup";

export const CHECKPOINT_DIFF_BYTES = 10_000_000;
export const CHECKPOINT_LIST_BYTES = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const groups = new Set<number>();
let reportGroups: (pgids: readonly number[]) => void = () => {};

/** Main can reap these Git/filter groups even if the host itself is killed. */
export function watchCheckpointGroups(report: (pgids: readonly number[]) => void): void {
  reportGroups = report;
  reportGroups([...groups]);
}
const DURABLE = ["-c", "core.fsync=objects,reference", "-c", "core.fsyncMethod=fsync"];
const INDEX_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "sparse.expectFilesOutsideOfPatterns=false",
];

/** A failure is never returned as an empty diff or a missing repository. */
export class CheckpointGitError extends Error {
  readonly code: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], code: number | null, stderr: string, message: string) {
    const command = args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "-c");
    super(`Checkpoint git ${command}: ${message}`);
    this.code = code;
    this.stderr = stderr;
  }
}

/** Do not let the process that launched Tondo redirect checkpoint writes to another repository. */
function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
  ])
    delete env[key];
  return { ...env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", ...extra };
}

function git(
  cwd: string,
  args: readonly string[],
  {
    env,
    input,
    cap = CHECKPOINT_LIST_BYTES,
  }: { env?: NodeJS.ProcessEnv; input?: string; cap?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: gitEnvironment(env),
      detached: true,
      stdio: "pipe",
    });
    if (child.pid) {
      groups.add(child.pid);
      reportGroups([...groups]);
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let errorBytes = 0;
    let failure: string | undefined;
    const stop = (message: string) => {
      failure ??= message;
      // Git filters inherit its group. Killing Git alone can leave a filter
      // holding stdout open forever after an output cap or deadline.
      if (child.pid) signalGroup(child.pid, "SIGKILL");
    };
    const deadline = setTimeout(() => stop(`exceeded ${GIT_TIMEOUT_MS} ms`), GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > cap) stop(`output exceeds ${cap.toLocaleString("en-US")} bytes`);
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > cap) stop(`error output exceeds ${cap.toLocaleString("en-US")} bytes`);
      else stderr.push(chunk);
    });
    child.on("error", (error) => {
      failure ??= error.message;
    });
    child.on("exit", (code, signal) => {
      if (code !== 0) stop(`exited with ${signal ?? code}`);
    });
    child.on("close", (code) => {
      void finish(code).catch(reject);
    });
    async function finish(code: number | null): Promise<void> {
      clearTimeout(deadline);
      if (child.pid) {
        await drainGroup(child.pid, 1000);
        groups.delete(child.pid);
        reportGroups([...groups]);
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      if (failure || code !== 0)
        reject(
          new CheckpointGitError(
            args,
            code,
            detail,
            failure?.startsWith("exited with") ? detail || failure : (failure ?? detail),
          ),
        );
      else {
        const output = Buffer.concat(stdout);
        if (!isUtf8(output))
          reject(new CheckpointGitError(args, null, "", "output is not valid UTF-8"));
        else resolve(output.toString("utf8"));
      }
    }
    // A failed Git can close stdin before a listing is written. Its exit carries the error.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export function checkpointRef(threadId: string, turn: number): string {
  if (!threadId || !Number.isSafeInteger(turn) || turn < 0)
    throw new Error("Invalid checkpoint identity");
  return `${checkpointPrefix(threadId)}${turn}`;
}

function checkpointPrefix(threadId: string): string {
  if (!threadId) throw new Error("Invalid checkpoint identity");
  return `refs/tondo/checkpoints/${Buffer.from(threadId).toString("base64url")}/turn/`;
}

/** Checkpoints cover the entire checkout, even if the project is a folder inside it. */
export async function checkpointRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  } catch (error) {
    if (error instanceof CheckpointGitError && error.stderr.includes("not a git repository"))
      return null;
    throw error;
  }
}

export async function hasCheckpoint(
  root: string,
  threadId: string,
  turn: number,
): Promise<boolean> {
  try {
    await git(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${checkpointRef(threadId, turn)}^{commit}`,
    ]);
    return true;
  } catch (error) {
    if (error instanceof CheckpointGitError && error.code === 1) return false;
    throw error;
  }
}

async function configTrue(root: string, name: string): Promise<boolean> {
  try {
    return (await git(root, ["config", "--bool", name])).trim() === "true";
  } catch (error) {
    if (error instanceof CheckpointGitError && error.code === 1) return false;
    throw error;
  }
}

/**
 * The real index is never written. Its staged additions and sparse exclusions seed
 * the private copy. Manual assume-unchanged/skip-worktree flags must not hide edits.
 */
async function seedIndex(
  root: string,
  index: string,
  sparse: boolean,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const realIndex = (
    await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  ).replace(/\n$/, "");
  let indexTime: number;
  try {
    const source = await stat(realIndex);
    indexTime = Math.max(1, Math.floor((source.mtimeMs - 1) / 1000));
    await copyFile(realIndex, index);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (sparse && !(await configTrue(root, "core.sparseCheckoutCone"))) {
      throw new Error("Cannot rebuild a checkpoint index for non-cone sparse checkout.", {
        cause: error,
      });
    }
    let head = false;
    try {
      await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
      head = true;
    } catch (failure) {
      if (!(failure instanceof CheckpointGitError && failure.code === 1)) throw failure;
    }
    if (head)
      await git(
        root,
        [...INDEX_CONFIG, "-c", "index.sparse=true", "read-tree", "--reset", "HEAD"],
        { env },
      );
    return;
  }
  const records = (await git(root, [...INDEX_CONFIG, "ls-files", "-v", "-z"], { env }))
    .split("\0")
    .filter(Boolean);
  const assumed = records.filter((entry) => /^[a-z]/.test(entry)).map((entry) => entry.slice(2));
  const skipped = records.filter((entry) => /^[Ss]/.test(entry)).map((entry) => entry.slice(2));
  if (assumed.length) {
    await git(root, [...INDEX_CONFIG, "update-index", "--no-assume-unchanged", "-z", "--stdin"], {
      env,
      input: assumed.join("\0") + "\0",
    });
  }
  // Preserve absent sparse exclusions. Selected skipped files are manual flags.
  const unskip =
    sparse && skipped.length
      ? (
          await git(root, [...INDEX_CONFIG, "sparse-checkout", "check-rules", "-z"], {
            env,
            input: skipped.join("\0") + "\0",
          })
        )
          .split("\0")
          .filter(Boolean)
      : skipped;
  if (unskip.length) {
    await git(root, [...INDEX_CONFIG, "update-index", "--no-skip-worktree", "-z", "--stdin"], {
      env,
      input: unskip.join("\0") + "\0",
    });
  }
  // Updating flags can rewrite the copy. Retain the source's racy-stat check so
  // same-size writes in its timestamp window cannot disappear from the snapshot.
  await utimes(index, indexTime, indexTime);
}

/** Capture without moving HEAD, running commit hooks, signing, or needing a Git identity. */
export async function captureCheckpoint(
  root: string,
  threadId: string,
  turn: number,
): Promise<void> {
  const ref = checkpointRef(threadId, turn);
  const gitDir = (await git(root, ["rev-parse", "--absolute-git-dir"])).replace(/\n$/, "");
  const temporary = await mkdtemp(path.join(gitDir, "tondo-checkpoint-"));
  const env: NodeJS.ProcessEnv = {
    GIT_INDEX_FILE: path.join(temporary, "index"),
    GIT_AUTHOR_NAME: "Tondo",
    GIT_AUTHOR_EMAIL: "tondo@localhost",
    GIT_COMMITTER_NAME: "Tondo",
    GIT_COMMITTER_EMAIL: "tondo@localhost",
  };
  try {
    const sparse = await configTrue(root, "core.sparseCheckout");
    await seedIndex(root, env.GIT_INDEX_FILE!, sparse, env);
    const stage = (exclusions: readonly string[]) =>
      git(
        root,
        [
          ...INDEX_CONFIG,
          ...DURABLE,
          "add",
          ...(sparse ? ["--sparse"] : []),
          "-A",
          "--",
          ".",
          ...exclusions,
        ],
        { env },
      );
    try {
      await stage([]);
    } catch (error) {
      if (!(error instanceof CheckpointGitError)) throw error;
      const candidates = (
        await git(root, [...INDEX_CONFIG, "ls-files", "--others", "--exclude-standard", "-z"], {
          env,
        })
      )
        .split("\0")
        .filter((entry) => entry.endsWith("/"));
      if (candidates.length > 64) throw error;
      const exclusions: string[] = [];
      for (const entry of candidates) {
        const nested = path.join(root, entry);
        try {
          // stat works for .git directories and the .git files used by worktrees.
          // oxlint-disable-next-line eslint/no-await-in-loop -- bounded recovery probes are sequential.
          await stat(path.join(nested, ".git"));
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw failure;
        }
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- do not inherit the parent's private index.
          await git(nested, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
        } catch (failure) {
          if (!(failure instanceof CheckpointGitError && failure.code === 1)) throw failure;
          exclusions.push(`:(exclude,literal)${entry}`);
        }
      }
      if (!exclusions.length) throw error;
      await stage(exclusions);
    }
    const tree = (await git(root, [...INDEX_CONFIG, ...DURABLE, "write-tree"], { env })).trim();
    const commit = (
      await git(root, [...DURABLE, "commit-tree", tree, "-m", `Tondo checkpoint ${ref}`], { env })
    ).trim();
    await git(root, [...DURABLE, "update-ref", ref, commit]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Return the exact bounded patch. No external diff drivers or textconv commands run. */
export function diffCheckpoints(
  root: string,
  threadId: string,
  from: number,
  to: number,
): Promise<string> {
  return git(
    root,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `${checkpointRef(threadId, from)}^{commit}`,
      `${checkpointRef(threadId, to)}^{commit}`,
      "--",
    ],
    { cap: CHECKPOINT_DIFF_BYTES },
  );
}

/** Names come from NUL-separated records, never from quoted patch headers. */
export async function checkpointFiles(
  root: string,
  threadId: string,
  from: number,
  to: number,
): Promise<CheckpointFile[]> {
  const patch = await diffCheckpoints(root, threadId, from, to);
  const names = (
    await git(root, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--find-renames",
      "--name-status",
      "-z",
      `${checkpointRef(threadId, from)}^{commit}`,
      `${checkpointRef(threadId, to)}^{commit}`,
      "--",
    ])
  ).split("\0");
  const patches = patch ? patch.split(/(?=^diff --git )/m) : [];
  const files: CheckpointFile[] = [];
  for (let i = 0; i < names.length - 1;) {
    const status = names[i++]!;
    const first = names[i++]!;
    const previousPath = status.startsWith("R") ? first : null;
    const name = previousPath === null ? first : names[i++]!;
    const filePatch = patches[files.length];
    if (!name || !filePatch) throw new Error("Checkpoint file listing does not match its patch");
    files.push({
      path: name,
      previousPath,
      status: status[0]!,
      binary: /^Binary files /m.test(filePatch),
      patch: filePatch,
    });
  }
  if (files.length !== patches.length)
    throw new Error("Checkpoint patch does not match its file listing");
  return files;
}

/** Only this thread's namespace is deleted, including refs Git packed. */
export async function deleteCheckpoints(root: string, threadId: string): Promise<void> {
  const prefix = checkpointPrefix(threadId);
  const refs = (await git(root, ["for-each-ref", "--format=%(refname)", prefix]))
    .split("\n")
    .filter(Boolean);
  if (refs.some((ref) => !ref.startsWith(prefix)))
    throw new Error("Checkpoint ref outside thread namespace");
  if (refs.length)
    await git(root, [...DURABLE, "update-ref", "--stdin"], {
      input: `start\n${refs.map((ref) => `delete ${ref}\n`).join("")}prepare\ncommit\n`,
    });
}
