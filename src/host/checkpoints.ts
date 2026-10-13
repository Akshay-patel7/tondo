// Hidden-ref checkpoints and sparse-index handling adapted from T3 Code's
// apps/server/src/vcs/GitVcsDriver.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type { CheckpointFile, CheckpointStats } from "../shared/checkpoints";
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
    let spawnCode: string | undefined;
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
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnCode ??= error.code;
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
      // A missing working folder fails the spawn with ENOENT, which reads as a missing git.
      if (spawnCode === "ENOENT" && !(await isFolder(cwd)))
        failure = `the folder ${cwd} no longer exists`;
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

async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
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

/**
 * Capture without moving HEAD, running commit hooks, signing, or needing a Git identity.
 * Resolves with the nested repositories and submodules whose uncommitted contents the
 * checkpoint can't hold: a gitlink records only the nested HEAD, and repositories
 * without a commit are left out.
 */
export async function captureCheckpoint(
  root: string,
  threadId: string,
  turn: number,
): Promise<string[]> {
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
    const excluded: string[] = [];
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
          excluded.push(entry.slice(0, -1));
        }
      }
      if (!exclusions.length) throw error;
      await stage(exclusions);
    }
    // After add -A, a gitlink differs from the work tree only when its repository has
    // uncommitted changes or untracked files.
    const dirty = (
      await git(
        root,
        [...INDEX_CONFIG, "diff-files", "--raw", "--no-abbrev", "-z", "--ignore-submodules=none"],
        { env },
      )
    ).split("\0");
    for (let i = 0; i < dirty.length - 1; i += 2) {
      if (dirty[i]!.startsWith(":160000 160000 ")) excluded.push(dirty[i + 1]!);
    }
    const tree = (await git(root, [...INDEX_CONFIG, ...DURABLE, "write-tree"], { env })).trim();
    const commit = (
      await git(root, [...DURABLE, "commit-tree", tree, "-m", `Tondo checkpoint ${ref}`], { env })
    ).trim();
    await git(root, [...DURABLE, "update-ref", ref, commit]);
    return excluded;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"];

function checkpointRange(threadId: string, from: number, to: number): string[] {
  return [`${checkpointRef(threadId, from)}^{commit}`, `${checkpointRef(threadId, to)}^{commit}`];
}

function patchBetween(
  root: string,
  range: readonly string[],
  pathspecs: readonly string[] = [],
): Promise<string> {
  return git(root, [...DIFF, "--src-prefix=a/", "--dst-prefix=b/", ...range, "--", ...pathspecs], {
    cap: CHECKPOINT_DIFF_BYTES,
  });
}

/** Return the exact bounded patch. No external diff drivers or textconv commands run. */
export function diffCheckpoints(
  root: string,
  threadId: string,
  from: number,
  to: number,
): Promise<string> {
  return patchBetween(root, checkpointRange(threadId, from, to));
}

/** Count every text line, including files whose patches exceed the preview cap. Binary files add none. */
export async function checkpointStats(
  root: string,
  threadId: string,
  from: number,
  to: number,
): Promise<CheckpointStats> {
  const output = await git(root, [
    ...DIFF,
    "--numstat",
    "-z",
    ...checkpointRange(threadId, from, to),
    "--",
  ]);
  const records = output.split("\0");
  let added = 0;
  let removed = 0;
  for (let i = 0; i < records.length - 1; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(records[i]!);
    if (!match) throw new Error("Checkpoint line counts are invalid");
    if (match[1] !== "-" && match[2] !== "-") {
      added += Number(match[1]);
      removed += Number(match[2]);
    }
    // With -z, a rename has an empty name here, then two NUL-separated paths.
    if (match[3] === "") i += 2;
  }
  if (!Number.isSafeInteger(added) || !Number.isSafeInteger(removed))
    throw new Error("Checkpoint line counts exceed safe integers");
  return { added, removed, error: null };
}

/** Most files listed without a patch before the rest are given up on. */
const MAX_OVERSIZED = 1000;

/**
 * The paths whose patches can't share the cap, from blob sizes. A patch holds each
 * old and new line at most once, plus a prefix byte per line, so twice the two
 * blobs' sizes bounds it. The smallest files are kept first.
 */
async function oversizedPaths(root: string, range: readonly string[]): Promise<string[]> {
  const raw = (await git(root, [...DIFF, "--raw", "--no-abbrev", "-z", ...range, "--"])).split(
    "\0",
  );
  const entries: { paths: string[]; oids: string[] }[] = [];
  for (let i = 0; i < raw.length - 1;) {
    const [oldMode, newMode, oldOid, newOid, status] = raw[i++]!.slice(1).split(" ");
    const paths = /^[RC]/.test(status!) ? [raw[i++]!, raw[i++]!] : [raw[i++]!];
    const oids = [
      [oldMode, oldOid],
      [newMode, newOid],
    ]
      .filter(([mode, oid]) => mode !== "160000" && !/^0+$/.test(oid!))
      .map(([, oid]) => oid!);
    entries.push({ paths, oids });
  }
  const oids = [...new Set(entries.flatMap((entry) => entry.oids))];
  const sizes = new Map<string, number>();
  if (oids.length) {
    const listing = await git(root, ["cat-file", "--batch-check=%(objectname) %(objectsize)"], {
      input: oids.join("\n") + "\n",
    });
    for (const line of listing.split("\n")) {
      const [oid, size] = line.split(" ");
      if (oid && size && /^\d+$/.test(size)) sizes.set(oid, Number(size));
    }
  }
  const estimates = entries
    .map(({ paths, oids: blobs }) => ({
      paths,
      bytes: 4096 + blobs.reduce((sum, oid) => sum + 2 * (sizes.get(oid) ?? 0), 0),
    }))
    .toSorted((a, b) => a.bytes - b.bytes);
  let budget = CHECKPOINT_DIFF_BYTES;
  const oversized: string[] = [];
  for (const { paths, bytes } of estimates) {
    if (bytes <= budget) budget -= bytes;
    else oversized.push(...paths);
  }
  return oversized;
}

/**
 * Names come from NUL-separated records, never from quoted patch headers. When the
 * whole patch is over the cap, the largest files are listed with an empty patch, which
 * no listed file otherwise has, so the rest of the turn stays readable.
 */
export async function checkpointFiles(
  root: string,
  threadId: string,
  from: number,
  to: number,
): Promise<CheckpointFile[]> {
  const range = checkpointRange(threadId, from, to);
  const names = (await git(root, [...DIFF, "--name-status", "-z", ...range, "--"])).split("\0");
  let oversized = new Set<string>();
  let patch: string;
  try {
    patch = await patchBetween(root, range);
  } catch (error) {
    if (!(error instanceof CheckpointGitError && error.message.includes("output exceeds")))
      throw error;
    const paths = await oversizedPaths(root, range);
    if (!paths.length || paths.length > MAX_OVERSIZED) throw error;
    oversized = new Set(paths);
    patch = await patchBetween(
      root,
      range,
      paths.map((name) => `:(exclude,literal)${name}`),
    );
  }
  const patches = patch ? patch.split(/(?=^diff --git )/m) : [];
  const files: CheckpointFile[] = [];
  let next = 0;
  for (let i = 0; i < names.length - 1;) {
    const status = names[i++]!;
    const first = names[i++]!;
    const previousPath = status.startsWith("R") ? first : null;
    const name = previousPath === null ? first : names[i++]!;
    if (name && oversized.has(name)) {
      files.push({ path: name, previousPath, status: status[0]!, binary: false, patch: "" });
      continue;
    }
    const filePatch = patches[next++];
    if (!name || !filePatch) throw new Error("Checkpoint file listing does not match its patch");
    files.push({
      path: name,
      previousPath,
      status: status[0]!,
      binary: /^Binary files /m.test(filePatch),
      patch: filePatch,
    });
  }
  if (next !== patches.length) throw new Error("Checkpoint patch does not match its file listing");
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
