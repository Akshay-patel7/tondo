import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  captureCheckpoint,
  checkpointFiles,
  checkpointRef,
  checkpointRoot,
  deleteCheckpoints,
  diffCheckpoints,
  hasCheckpoint,
} from "./checkpoints";

let folder: string;
const thread = "thread /with odd:characters 🔎";
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: "pipe" });
}
function write(name: string, data: string | Buffer): void {
  mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
  writeFileSync(path.join(folder, name), data);
}
function contents(turn: number, name: string): string {
  return git("show", `${checkpointRef(thread, turn)}:${name}`);
}
function commit(): void {
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", "fixture");
}
function refs(): string {
  return git("for-each-ref", "--format=%(refname)", "refs/tondo");
}
function capture(turn: number): Promise<void> {
  return captureCheckpoint(folder, thread, turn);
}

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-checkpoints-")));
  // Tests never use the developer's Git identity, signing or global filters.
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ])
    vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

describe("Git checkpoints", () => {
  test("encodes a thread namespace and rejects invalid turn numbers", () => {
    expect(checkpointRef("hello", 2)).toBe("refs/tondo/checkpoints/aGVsbG8/turn/2");
    for (const turn of [-1, 1.5, NaN, Infinity])
      expect(() => checkpointRef(thread, turn)).toThrow();
    expect(() => checkpointRef("", 0)).toThrow();
  });

  test("distinguishes non-Git and missing folders, and resolves the whole checkout", async () => {
    expect(await checkpointRoot(folder)).toBeNull();
    await expect(checkpointRoot(path.join(folder, "missing"))).rejects.toThrow();
    git("init", "-q");
    mkdirSync(path.join(folder, "sub"));
    expect(await checkpointRoot(path.join(folder, "sub"))).toBe(await checkpointRoot(folder));
  });

  test.each([" trailing space ", "trailing-newline\n"])(
    "does not trim a repository path ending in %j",
    async (suffix) => {
      const next = folder + suffix;
      renameSync(folder, next);
      folder = next;
      git("init", "-q");
      const root = await checkpointRoot(folder);
      expect(root).toBe(folder);
      write("file.txt", "kept\n");
      await captureCheckpoint(root!, thread, 0);
      expect(contents(0, "file.txt")).toBe("kept\n");
    },
  );

  test("uses a linked worktree's index and ignores inherited Git repository bindings", async () => {
    git("init", "-q");
    write("file.txt", "main\n");
    commit();
    const linked = mkdtempSync(path.join(tmpdir(), "tondo-linked-checkpoint-"));
    try {
      git("worktree", "add", "--detach", linked, "HEAD");
      const indexPath = git(
        "-C",
        linked,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      ).trim();
      const index = readFileSync(indexPath);
      writeFileSync(path.join(linked, "file.txt"), "linked\n");
      vi.stubEnv("GIT_DIR", path.join(folder, ".git"));
      vi.stubEnv("GIT_WORK_TREE", folder);
      vi.stubEnv("GIT_INDEX_FILE", path.join(folder, ".git/index"));
      await captureCheckpoint(linked, thread, 0);
      vi.stubEnv("GIT_DIR", undefined);
      vi.stubEnv("GIT_WORK_TREE", undefined);
      vi.stubEnv("GIT_INDEX_FILE", undefined);
      expect(contents(0, "file.txt")).toBe("linked\n");
      expect(readFileSync(path.join(folder, "file.txt"), "utf8")).toBe("main\n");
      expect(readFileSync(indexPath)).toEqual(index);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });

  test("captures an unborn repository without identity, hooks, signing, HEAD or a real index", async () => {
    git("init", "-q");
    git("config", "commit.gpgsign", "true");
    write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    chmodSync(path.join(folder, ".git/hooks/pre-commit"), 0o755);
    write("new.txt", "new\n");
    const head = readFileSync(path.join(folder, ".git/HEAD"));
    expect(await hasCheckpoint(folder, thread, 0)).toBe(false);
    await capture(0);
    expect(await hasCheckpoint(folder, thread, 0)).toBe(true);
    expect(contents(0, "new.txt")).toBe("new\n");
    expect(readFileSync(path.join(folder, ".git/HEAD"))).toEqual(head);
    expect(existsSync(path.join(folder, ".git/index"))).toBe(false);
    expect(git("show", "-s", "--format=%an <%ae>", checkpointRef(thread, 0))).toBe(
      "Tondo <tondo@localhost>\n",
    );
  });

  test("edits, additions, deletions, renames, binaries, symlinks and ignore rules without touching staging", async () => {
    git("init", "-q");
    write("edit.txt", "before\n");
    write("remove.txt", "gone\n");
    write("rename.txt", "keep this exact content\n");
    write("image.bin", Buffer.from([0, 1, 2]));
    write(".gitignore", "ignored*\n");
    commit();
    write("edit.txt", "staged\n");
    git("add", "edit.txt");
    write("edit.txt", "before\n");
    write("ignored-staged.txt", "already tracked in the index\n");
    git("add", "-f", "ignored-staged.txt");
    write("ignored-secret.txt", "do not snapshot\n");
    const index = readFileSync(path.join(folder, ".git/index"));
    const head = git("rev-parse", "HEAD");
    await capture(0);
    write("edit.txt", "after\n");
    write("new\tfile.txt", "new\n");
    rmSync(path.join(folder, "remove.txt"));
    renameSync(path.join(folder, "rename.txt"), path.join(folder, "renamed.txt"));
    write("image.bin", Buffer.from([0, 3, 4]));
    symlinkSync("edit.txt", path.join(folder, "link"));
    await capture(1);
    const diff = await diffCheckpoints(folder, thread, 0, 1);
    expect(diff).toContain("-before\n+after");
    expect(diff).toContain("deleted file mode");
    expect(diff).toContain("rename from rename.txt\nrename to renamed.txt");
    expect(diff).toContain("Binary files");
    expect(diff).toContain("new file mode 120000");
    expect(contents(1, "new\tfile.txt")).toBe("new\n");
    const files = await checkpointFiles(folder, thread, 0, 1);
    expect(files.find((file) => file.path === "new\tfile.txt")).toMatchObject({ status: "A" });
    expect(files.find((file) => file.path === "renamed.txt")).toMatchObject({
      previousPath: "rename.txt",
      status: "R",
    });
    expect(files.find((file) => file.path === "image.bin")).toMatchObject({ binary: true });
    expect(contents(0, "ignored-staged.txt")).toContain("already tracked");
    expect(git("ls-tree", "-r", "--name-only", checkpointRef(thread, 1))).not.toContain(
      "ignored-secret",
    );
    expect(readFileSync(path.join(folder, ".git/index"))).toEqual(index);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(
      readdirSync(path.join(folder, ".git")).filter((name) => name.startsWith("tondo-checkpoint-")),
    ).toEqual([]);
  });

  test("same-size writes and manual index flags cannot hide a worktree edit or deletion", async () => {
    git("init", "-q");
    for (const file of ["racy.txt", "assumed.txt", "skipped.txt", "deleted.txt"])
      write(file, "before\n");
    commit();
    git("update-index", "--assume-unchanged", "assumed.txt");
    git("update-index", "--skip-worktree", "skipped.txt", "deleted.txt");
    const index = readFileSync(path.join(folder, ".git/index"));
    for (const file of ["racy.txt", "assumed.txt", "skipped.txt"]) write(file, "edited\n");
    rmSync(path.join(folder, "deleted.txt"));
    await capture(0);
    for (const file of ["racy.txt", "assumed.txt", "skipped.txt"])
      expect(contents(0, file)).toBe("edited\n");
    expect(git("ls-tree", "--name-only", checkpointRef(thread, 0))).not.toContain("deleted.txt");
    expect(readFileSync(path.join(folder, ".git/index"))).toEqual(index);
  });

  test.each(["cone", "non-cone"])(
    "preserves absent %s sparse files, and captures present files outside the patterns",
    async (mode) => {
      git("init", "-q");
      write("included/a.txt", "before\n");
      write("excluded/b.txt", "unchanged\n");
      commit();
      git(
        "sparse-checkout",
        "set",
        mode === "cone" ? "--cone" : "--no-cone",
        ...(mode === "cone" ? ["included"] : ["/included/"]),
      );
      const index = readFileSync(path.join(folder, ".git/index"));
      expect(existsSync(path.join(folder, "excluded/b.txt"))).toBe(false);
      await capture(0);
      write("included/a.txt", "after\n");
      write("outside/new.txt", "outside\n");
      await capture(1);
      expect(contents(1, "excluded/b.txt")).toBe("unchanged\n");
      expect(contents(1, "outside/new.txt")).toBe("outside\n");
      const diff = await diffCheckpoints(folder, thread, 0, 1);
      expect(diff).toContain("+after");
      expect(diff).not.toContain("excluded/b.txt");
      expect(readFileSync(path.join(folder, ".git/index"))).toEqual(index);
    },
  );

  test("rebuilds a missing cone index, but refuses to invent non-cone exclusions", async () => {
    git("init", "-q");
    write("included/a.txt", "before\n");
    write("excluded/b.txt", "unchanged\n");
    commit();
    git("sparse-checkout", "set", "--cone", "included");
    rmSync(path.join(folder, ".git/index"));
    await capture(0);
    expect(contents(0, "excluded/b.txt")).toBe("unchanged\n");
    git("-c", "index.sparse=true", "read-tree", "--reset", "HEAD");
    git("sparse-checkout", "set", "--no-cone", "/included/");
    rmSync(path.join(folder, ".git/index"));
    await expect(capture(1)).rejects.toThrow("non-cone sparse checkout");
    expect(await hasCheckpoint(folder, thread, 1)).toBe(false);
  });

  test("excludes an unborn embedded repository but keeps a committed one as a gitlink", async () => {
    git("init", "-q");
    write("normal.txt", "normal\n");
    for (const name of ["empty [repo]", "committed"]) {
      mkdirSync(path.join(folder, name));
      git("init", "-q", name);
    }
    write("committed/file.txt", "nested\n");
    git("-C", "committed", "add", ".");
    git(
      "-C",
      "committed",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "nested",
    );
    await capture(0);
    const tree = git("ls-tree", checkpointRef(thread, 0));
    expect(tree).not.toContain("empty [repo]");
    expect(tree).toContain("160000 commit");
    expect(tree).toContain("normal.txt");
  });

  test("bounds patches at 10,000,000 bytes rather than returning a partial diff", async () => {
    git("init", "-q");
    write("huge.txt", "before\n");
    await capture(0);
    write("huge.txt", "a".repeat(10_000_000) + "\n");
    await capture(1);
    await expect(diffCheckpoints(folder, thread, 0, 1)).rejects.toThrow(
      "output exceeds 10,000,000 bytes",
    );
  });

  test("missing checkpoints are errors, never an invented HEAD baseline", async () => {
    git("init", "-q");
    write("new.txt", "new\n");
    await capture(1);
    await expect(diffCheckpoints(folder, thread, 0, 1)).rejects.toThrow();
    expect(await hasCheckpoint(folder, thread, 0)).toBe(false);
  });

  test("deletes only the requested thread's refs, including packed refs", async () => {
    git("init", "-q");
    write("file.txt", "one\n");
    await capture(0);
    await capture(1);
    await captureCheckpoint(folder, "another", 0);
    git("pack-refs", "--all");
    await deleteCheckpoints(folder, thread);
    expect(refs()).toBe(checkpointRef("another", 0) + "\n");
    await deleteCheckpoints(folder, thread);
  });

  test("a SIGKILL during capture leaves a clean fsck, the real index intact and no broken ref", async () => {
    git("init", "-q");
    write("safe.txt", "initial\n");
    commit();
    await capture(0);
    const index = readFileSync(path.join(folder, ".git/index"));
    const before = refs();
    // Git runs this clean filter during add. exec makes Git its direct parent.
    // It only kills a Git using a private checkpoint index, never the test runner.
    write(
      ".git/kill-capture.cjs",
      `const fs = require('node:fs');\nconst index = process.env.GIT_INDEX_FILE;\nif (!index || !index.includes('tondo-checkpoint-')) process.exit(90);\nfs.writeFileSync(${JSON.stringify(path.join(folder, ".git/killed-index"))}, index);\nprocess.kill(process.ppid, 'SIGKILL');\n`,
    );
    git(
      "config",
      "filter.interrupt.clean",
      `exec '${process.execPath}' '${path.join(folder, ".git/kill-capture.cjs")}'`,
    );
    git("config", "filter.interrupt.required", "true");
    write(".gitattributes", "killed.txt filter=interrupt\n");
    write("killed.txt", "capture this\n");
    await expect(capture(1)).rejects.toThrow();
    expect(readFileSync(path.join(folder, ".git/killed-index"), "utf8")).toContain(
      "tondo-checkpoint-",
    );
    expect(readFileSync(path.join(folder, ".git/index"))).toEqual(index);
    expect(refs()).toBe(before);
    git("fsck", "--full");
    git("config", "--remove-section", "filter.interrupt");
    rmSync(path.join(folder, ".gitattributes"));
    await capture(1);
    expect(contents(1, "killed.txt")).toBe("capture this\n");
    git("fsck", "--full");
    expect(existsSync(path.join(folder, ".git/index.lock"))).toBe(false);
  });
});
