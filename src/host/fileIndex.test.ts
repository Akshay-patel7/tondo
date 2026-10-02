import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FileIndexes, indexFiles, parseFileList } from "./fileIndex";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "tondo-files-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: folder, stdio: "pipe" });
}

describe("file index", () => {
  test("lists tracked and untracked paths, but not ignored untracked files or .git", async () => {
    git("init", "-q");
    writeFileSync(path.join(folder, ".gitignore"), "ignored*\n");
    writeFileSync(path.join(folder, "tracked.txt"), "not sent to the renderer");
    writeFileSync(path.join(folder, "ignored-tracked.txt"), "tracked anyway");
    git("add", "tracked.txt");
    git("add", "-f", "ignored-tracked.txt");
    writeFileSync(path.join(folder, "ignored-secret.txt"), "not listed");
    writeFileSync(path.join(folder, "space name.txt"), "untracked");
    mkdirSync(path.join(folder, "sub"));
    writeFileSync(path.join(folder, "sub", "one.txt"), "nested");
    expect(await indexFiles(folder)).toEqual({
      paths: [".gitignore", "ignored-tracked.txt", "space name.txt", "sub/one.txt", "tracked.txt"],
      truncated: false,
      error: null,
    });
    expect((await indexFiles(path.join(folder, "sub"))).paths).toEqual(["one.txt"]);
  });

  test("caps, deduplicates and excludes paths that pi's quoted syntax cannot represent", () => {
    expect(parseFileList('b\0a\0a\0quote".txt\0new\nline\0back\\slash\0c\0', 2)).toEqual({
      paths: ["a", "b"],
      truncated: true,
      error: null,
    });
    expect(parseFileList("a\0b\0", 2).truncated).toBe(false);
  });

  test("shares concurrent scans but sees new files on the next scan", async () => {
    git("init", "-q");
    const index = new FileIndexes();
    const first = index.read(folder);
    expect(index.read(folder)).toBe(first);
    expect((await first).paths).toEqual([]);
    writeFileSync(path.join(folder, "new.txt"), "");
    expect((await index.read(folder)).paths).toEqual(["new.txt"]);
  });

  test("explains non-Git folders and missing folders instead of pretending they're empty", async () => {
    expect((await indexFiles(folder)).error).toContain("need a Git project");
    expect((await indexFiles(path.join(folder, "missing"))).error).toContain(
      "Couldn't list project files",
    );
  });
});
