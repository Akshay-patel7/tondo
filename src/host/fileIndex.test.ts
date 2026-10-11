import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FILE_INDEX_PATHS, FileIndexes, indexFiles, parseFileList } from "./fileIndex";

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

  test("over the cap, keeps files from every folder instead of cutting late folders", () => {
    const bulk = Array.from({ length: 12 }, (_, n) => `bulk/f${String(n).padStart(2, "0")}`);
    const listing = ["zzz-last.txt", "src/main.ts", ...bulk, "README.md", "aaa-first.txt"];
    expect(parseFileList(`${listing.join("\0")}\0`, 7)).toEqual({
      paths: [
        "README.md",
        "aaa-first.txt",
        "bulk/f00",
        "bulk/f01",
        "bulk/f02",
        "src/main.ts",
        "zzz-last.txt",
      ],
      truncated: true,
      error: null,
    });
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

  test("over the cap, a search finds any file by name, ranked like the menu's", async () => {
    git("init", "-q");
    mkdirSync(path.join(folder, "bulk"));
    for (let n = 0; n <= FILE_INDEX_PATHS; n++)
      writeFileSync(path.join(folder, "bulk", `f${String(n).padStart(5, "0")}.txt`), "");
    mkdirSync(path.join(folder, "src"));
    writeFileSync(path.join(folder, "src", "main.ts"), "");
    const files = new FileIndexes();
    const index = await files.read(folder);
    expect(index.truncated).toBe(true);
    const last = `bulk/f${String(FILE_INDEX_PATHS).padStart(5, "0")}.txt`;
    expect(index.paths).not.toContain(last);
    expect(await files.find(folder, "main.ts")).toEqual(["src/main.ts"]);
    expect(await files.find(folder, `f${String(FILE_INDEX_PATHS).padStart(5, "0")}`)).toEqual([
      last,
    ]);
    expect(await files.find(folder, "bulk/f")).toHaveLength(20);
  });

  test("a search before any scan, or of a small project, reads the listing itself", async () => {
    git("init", "-q");
    writeFileSync(path.join(folder, "readme.md"), "");
    expect(await new FileIndexes().find(folder, "READ")).toEqual(["readme.md"]);
  });

  test("explains non-Git folders and missing folders instead of pretending they're empty", async () => {
    expect((await indexFiles(folder)).error).toContain("need a Git project");
    expect((await indexFiles(path.join(folder, "missing"))).error).toBe(
      `Couldn't list project files: the folder ${path.join(folder, "missing")} no longer exists`,
    );
  });
});
