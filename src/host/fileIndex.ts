import { execFile } from "node:child_process";
import { canMention, type FileIndex } from "../shared/files";

/** Listing is bounded both before decoding and before sending to the page. */
export const FILE_INDEX_BYTES = 16 * 1024 * 1024;
export const FILE_INDEX_PATHS = 10_000;

export function parseFileList(output: string, limit = FILE_INDEX_PATHS): FileIndex {
  const paths = [...new Set(output.split("\0").filter(canMention))].toSorted();
  return { paths: paths.slice(0, limit), truncated: paths.length > limit, error: null };
}

/** git respects ignore rules for untracked files, but keeps tracked files even if now ignored. */
export function indexFiles(project: string): Promise<FileIndex> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"],
      {
        cwd: project,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        maxBuffer: FILE_INDEX_BYTES,
        timeout: 10_000,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          const reason = stderr.includes("not a git repository")
            ? "File suggestions need a Git project. You can still type a path."
            : `Couldn't list project files: ${error.message}`;
          resolve({ paths: [], truncated: false, error: reason });
        } else resolve(parseFileList(stdout));
      },
    );
  });
}

/** Shares only in-flight scans. Reopening the menu reads new and removed files again. */
export class FileIndexes {
  private readonly pending = new Map<string, Promise<FileIndex>>();

  read(project: string): Promise<FileIndex> {
    const existing = this.pending.get(project);
    if (existing) return existing;
    const scan = indexFiles(project).finally(() => this.pending.delete(project));
    this.pending.set(project, scan);
    return scan;
  }
}
