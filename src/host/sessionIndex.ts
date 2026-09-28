// Lists a project's pi sessions for the sidebar by reading pi's session files,
// read-only. It follows buildSessionInfo in pi 0.87.1's
// core/session-manager.js, which /resume lists sessions with, but parses only
// the lines it needs: the header, the first thing you asked, your latest name
// for the thread and its last message. It keeps what it read and reads a file
// again only when its size or modification time changes.
import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SessionFolder } from "./sessionFolder";

export interface SessionSummary {
  /** pi's session id, from the header. */
  readonly id: string;
  readonly file: string;
  /** The folder pi ran in, from the header, or "" if the header has none. */
  readonly cwd: string;
  readonly createdAt: number;
  /** When the thread last had a message from you or pi, as /resume sorts it. */
  readonly updatedAt: number;
  /** The name you gave the thread, if you did. */
  readonly name: string | undefined;
  /** The first thing you asked, on one line and cut to TITLE_LENGTH, or "" before you ask anything. */
  readonly firstMessage: string;
}

export const TITLE_LENGTH = 100;

/** Files read at once. pi reads 10. */
const CONCURRENCY = 8;

/** A session_info entry's type, as JSON writes it. JSON escapes quotes inside strings, so this can't come from text you typed. */
const NAME_TOKEN = '"session_info"';

interface Cached {
  readonly mtimeMs: number;
  readonly size: number;
  readonly summary: SessionSummary | null;
}

export class SessionIndex {
  private readonly cache = new Map<string, Cached>();

  /** The sessions pi lists for `project`, read from `folder`. */
  async list(project: string, folder: SessionFolder): Promise<SessionSummary[]> {
    let names: string[];
    try {
      names = await readdir(folder.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(`Can't read pi's session folder ${folder.dir}`, { cause: error });
    }
    const files = names
      .filter((name) => name.endsWith(".jsonl"))
      .toSorted()
      .map((name) => path.join(folder.dir, name));
    this.forgetMissing(folder.dir, new Set(files));
    const summaries = await mapLimit(files, CONCURRENCY, (file) => this.summary(file));
    const cwd = path.resolve(project);
    return summaries.filter(
      (summary): summary is SessionSummary =>
        summary !== null &&
        // A shared folder holds other projects' sessions too.
        (!folder.shared || (summary.cwd !== "" && path.resolve(summary.cwd) === cwd)),
    );
  }

  /** Reads one session file, or returns what it read last time if the file hasn't changed. Null if it isn't a session. */
  async summary(file: string): Promise<SessionSummary | null> {
    let stats: Stats;
    try {
      stats = await stat(file);
    } catch {
      this.cache.delete(file);
      return null;
    }
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.summary;
    }
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return null;
    }
    const summary = summarize(file, text, stats.mtimeMs);
    this.cache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, summary });
    return summary;
  }

  private forgetMissing(dir: string, present: ReadonlySet<string>): void {
    for (const file of this.cache.keys()) {
      if (path.dirname(file) === dir && !present.has(file)) this.cache.delete(file);
    }
  }
}

type Entry = Record<string, unknown>;

function summarize(file: string, text: string, mtimeMs: number): SessionSummary | null {
  let header: Entry | undefined;
  let firstMessage = "";
  for (let start = 0; start < text.length && !firstMessage;) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const value = parseLine(text.slice(start, end));
    start = end + 1;
    if (!value) continue;
    if (!header) {
      // pi reads a file as a session only if its first entry is the header.
      if (!isEntry(value) || value.type !== "session" || typeof value.id !== "string") return null;
      header = value;
      continue;
    }
    const message = chatMessage(value);
    if (message?.role === "user") firstMessage = textOf(message);
  }
  if (!header) return null;
  const created = timeOf(header.timestamp);
  return {
    id: header.id as string,
    file,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    createdAt: created ?? mtimeMs,
    updatedAt: lastActivity(text) ?? created ?? mtimeMs,
    name: lastName(text),
    firstMessage: oneLine(firstMessage),
  };
}

/** Parses a line as pi does, with blank and malformed lines coming back as null. */
function parseLine(line: string): unknown {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The message of a user or assistant message entry with content, the only messages /resume looks at. */
function chatMessage(entry: unknown): Entry | undefined {
  if (!isEntry(entry) || entry.type !== "message" || !isEntry(entry.message)) return undefined;
  const message = entry.message;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  return "content" in message ? message : undefined;
}

/** A message's text blocks, joined with spaces as pi joins them. */
function textOf(message: Entry): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) =>
      isEntry(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .filter(Boolean)
    .join(" ");
}

function timeOf(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * When the thread last had a message, from the last one in the file. pi takes
 * the latest time over every message, which is the same thing unless the
 * clock went back.
 */
function lastActivity(text: string): number | undefined {
  for (let end = text.length; end > 0;) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    const entry = parseLine(text.slice(start, end));
    end = start - 1;
    const message = chatMessage(entry);
    if (!message) continue;
    const time =
      typeof message.timestamp === "number"
        ? message.timestamp
        : timeOf((entry as Entry).timestamp);
    if (time !== undefined && time > 0) return time;
  }
  return undefined;
}

/** The name from the last session_info entry. A name you cleared counts, as in pi. */
function lastName(text: string): string | undefined {
  for (let at = text.lastIndexOf(NAME_TOKEN); at !== -1;) {
    const start = text.lastIndexOf("\n", at) + 1;
    const newline = text.indexOf("\n", at);
    const entry = parseLine(text.slice(start, newline === -1 ? text.length : newline));
    if (isEntry(entry) && entry.type === "session_info") {
      return typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
    }
    if (start === 0) break;
    at = text.lastIndexOf(NAME_TOKEN, start - 1);
  }
  return undefined;
}

/** A message's text as the sidebar titles a thread with it: on one line and cut to TITLE_LENGTH. */
export function messageTitle(message: unknown): string {
  return isEntry(message) ? oneLine(textOf(message)) : "";
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

/** Maps `items` with at most `limit` calls running at once, keeping their order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      // oxlint-disable-next-line eslint/no-await-in-loop -- each worker maps one item at a time.
      results[index] = await map(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
