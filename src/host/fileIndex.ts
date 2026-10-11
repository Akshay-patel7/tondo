import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { matchingFiles } from "../shared/fileMatches";
import { canMention, type FileIndex } from "../shared/files";

/** Listing is bounded both before decoding and before sending to the page. */
export const FILE_INDEX_BYTES = 16 * 1024 * 1024;
export const FILE_INDEX_PATHS = 10_000;

/**
 * Over the limit, a lexical cut would drop every folder that sorts late. The
 * cut takes each folder's first file, then each folder's second, and so on,
 * shallower files first in each round, so only the tails of big folders go.
 */
export function parseFileList(output: string, limit = FILE_INDEX_PATHS): FileIndex {
  return capFiles(mentionable(output), limit);
}

/** Every listed path pi's editor can mention, once each, sorted. */
function mentionable(output: string): string[] {
  return [...new Set(output.split("\0").filter(canMention))].toSorted();
}

function capFiles(paths: readonly string[], limit = FILE_INDEX_PATHS): FileIndex {
  if (paths.length <= limit) return { paths, truncated: false, error: null };
  const taken = new Map<string, number>();
  const ranked = paths.map((path) => {
    const folder = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
    const turn = taken.get(folder) ?? 0;
    taken.set(folder, turn + 1);
    return { path, turn, depth: path.split("/").length };
  });
  const kept = ranked
    .toSorted((a, b) => a.turn - b.turn || a.depth - b.depth)
    .slice(0, limit)
    .map((entry) => entry.path)
    .toSorted();
  return { paths: kept, truncated: true, error: null };
}

/** git respects ignore rules for untracked files, but keeps tracked files even if now ignored. */
export async function indexFiles(project: string): Promise<FileIndex> {
  const listing = await listFiles(project);
  return "error" in listing
    ? { paths: [], truncated: false, error: listing.error }
    : capFiles(listing.paths);
}

function listFiles(project: string): Promise<{ paths: string[] } | { error: string }> {
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
          let reason = `Couldn't list project files: ${error.message}`;
          if (stderr.includes("not a git repository"))
            reason = "File suggestions need a Git project. You can still type a path.";
          // A missing working folder fails the spawn with ENOENT, which reads as a missing git.
          else if (error.code === "ENOENT" && !existsSync(project))
            reason = `Couldn't list project files: the folder ${project} no longer exists`;
          resolve({ error: reason });
        } else resolve({ paths: mentionable(stdout) });
      },
    );
  });
}

/**
 * Shares only in-flight scans. Reopening the menu reads new and removed files
 * again. The whole listing behind the last truncated index stays, so a search
 * as you type doesn't run git for each key.
 */
export class FileIndexes {
  private readonly pending = new Map<string, Promise<FileIndex>>();
  private listing: { readonly project: string; readonly paths: readonly string[] } | null = null;

  read(project: string): Promise<FileIndex> {
    const existing = this.pending.get(project);
    if (existing) return existing;
    const scan = listFiles(project)
      .then((listing): FileIndex => {
        if ("error" in listing) {
          if (this.listing?.project === project) this.listing = null;
          return { paths: [], truncated: false, error: listing.error };
        }
        const index = capFiles(listing.paths);
        if (index.truncated) this.listing = { project, paths: listing.paths };
        else if (this.listing?.project === project) this.listing = null;
        return index;
      })
      .finally(() => this.pending.delete(project));
    this.pending.set(project, scan);
    return scan;
  }

  /** The best matches for `query` among all of the project's files, not just the index's. */
  async find(project: string, query: string): Promise<string[]> {
    let paths = this.listing?.project === project ? this.listing.paths : null;
    if (paths === null) {
      const index = await this.read(project);
      paths = this.listing?.project === project ? this.listing.paths : index.paths;
    }
    return matchingFiles(paths, query);
  }
}
