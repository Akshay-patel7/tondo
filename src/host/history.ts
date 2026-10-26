// Read-only history for browsing. pi's get_messages is model context and
// deliberately drops summarized messages. Keep only offsets and ancestry here.
import { randomUUID } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import {
  HISTORY_PAGE_BYTES,
  HISTORY_PAGE_MESSAGES,
  historyText,
  type HistoryIndex,
  type HistoryPage,
  type HistoryPreview,
} from "../shared/history";
import { messageProblem, type PiMessage } from "../shared/thread";

const PREFIX_BYTES = 4096;
const MAX_ENTRIES = 200_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_COMPACTION_BYTES = HISTORY_PAGE_BYTES;

type RecordValue = Record<string, unknown>;
interface Entry {
  readonly id: string;
  readonly parent: string | null;
  readonly type: string;
  readonly role: "user" | "assistant" | "system" | undefined;
  readonly offset: number;
  readonly bytes: number;
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** pi writes identity before message/data/summary payloads. Never parse tool bodies to index them. */
function metadata(prefix: string): RecordValue | null {
  const payload = /,\s*"(?:message|data|summary|content)"\s*:/.exec(prefix);
  try {
    const value: unknown = JSON.parse(payload ? `${prefix.slice(0, payload.index)}}` : prefix);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

/** Keep canonical literals only. A long regexp capture can retain the entire 4 KiB prefix in V8. */
function indexedRole(prefix: string): Entry["role"] {
  const role = /"message"\s*:\s*\{\s*"role"\s*:\s*"([^"]+)"/.exec(prefix)?.[1];
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  return undefined;
}

/** A single visible session's offset index. No saved message bodies survive a request. */
export class SessionHistory {
  readonly revision = randomUUID();
  private readonly file: string;
  private readonly sessionId: string;
  private readonly entries: readonly Entry[];
  readonly prompts: readonly string[];

  private constructor(
    file: string,
    sessionId: string,
    entries: readonly Entry[],
    prompts: readonly string[],
  ) {
    this.file = file;
    this.sessionId = sessionId;
    this.entries = entries;
    this.prompts = prompts;
  }

  get index(): HistoryIndex {
    return { revision: this.revision, prompts: this.prompts };
  }

  static async read(
    file: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SessionHistory> {
    const handle = await open(file, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES)
        throw new Error("Saved history exceeds the 2 GiB browsing limit or isn't a regular file.");
      const entries: Entry[] = [];
      const byId = new Map<string, Entry>();
      const compactions = new Map<string, string>();
      const chunk = Buffer.alloc(64 * 1024);
      let prefix = Buffer.alloc(0);
      let offset = 0;
      let lineStart = 0;
      let header = false;
      const line = async (end: number) => {
        if (prefix.length === 0) return;
        const text = prefix.toString("utf8");
        if (!text.trim()) return;
        const value = metadata(text);
        if (!header) {
          if (value?.type !== "session" || value.id !== sessionId)
            throw new Error("The saved history no longer belongs to this thread.");
          header = true;
          return;
        }
        if (!value)
          throw new Error("Can't index a saved history entry. Reload the thread and try again.");
        if (typeof value.id !== "string" || typeof value.type !== "string") return;
        if (
          value.id.length > 128 ||
          (typeof value.parentId === "string" && value.parentId.length > 128) ||
          byId.has(value.id)
        )
          throw new Error("The saved history has an invalid or duplicate entry identity.");
        if (entries.length >= MAX_ENTRIES)
          throw new Error("Saved history exceeds the 200,000-entry browsing limit.");
        const entry: Entry = {
          id: value.id,
          parent: typeof value.parentId === "string" ? value.parentId : null,
          type: value.type,
          role: value.type === "message" ? indexedRole(text) : undefined,
          offset: lineStart,
          bytes: end - lineStart,
        };
        entries.push(entry);
        byId.set(entry.id, entry);
        if (entry.type === "compaction") {
          if (entry.bytes > MAX_COMPACTION_BYTES)
            throw new Error("A saved compaction exceeds the 1 MiB browsing limit.");
          const compacted = await readEntry(handle, entry);
          if (typeof compacted.firstKeptEntryId !== "string")
            throw new Error("The saved compaction has no retained entry.");
          compactions.set(entry.id, compacted.firstKeptEntryId);
        }
      };
      while (offset < stats.size) {
        signal?.throwIfAborted();
        // Read only the snapshot size; a streaming pi may keep appending.
        // oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential file scan.
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, stats.size - offset),
          offset,
        );
        if (bytesRead === 0) break;
        let start = 0;
        while (start < bytesRead) {
          const newline = chunk.indexOf(10, start);
          const end = newline === -1 || newline >= bytesRead ? bytesRead : newline;
          const keep = Math.min(end - start, PREFIX_BYTES - prefix.length);
          if (keep > 0) prefix = Buffer.concat([prefix, chunk.subarray(start, start + keep)]);
          if (end < bytesRead) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- each completed entry's metadata is processed in order.
            await line(offset + end);
            prefix = Buffer.alloc(0);
            lineStart = offset + end + 1;
          }
          start = end + 1;
        }
        offset += bytesRead;
      }
      // Ignore an incomplete final record while pi appends it.
      if (!header) throw new Error("The saved history has no session header.");
      const branch: Entry[] = [];
      const seen = new Set<string>();
      let current = entries.at(-1);
      while (current) {
        if (seen.has(current.id)) throw new Error("The saved history has a cyclic branch.");
        seen.add(current.id);
        branch.push(current);
        if (current.parent !== null && !byId.has(current.parent))
          throw new Error("The saved history branch has a missing parent.");
        current = current.parent === null ? undefined : byId.get(current.parent);
      }
      branch.reverse();
      const compaction = branch.findLast((entry) => compactions.has(entry.id));
      const keptId = compaction && compactions.get(compaction.id);
      const keptAt = keptId ? branch.findIndex((entry) => entry.id === keptId) : 0;
      if (keptAt === -1) throw new Error("The saved compaction points outside its branch.");
      const prompts = branch
        .slice(0, Math.max(0, keptAt))
        .filter((entry) => entry.role === "user")
        .map((entry) => entry.id);
      const messages = branch.filter(
        (entry) =>
          (entry.type === "message" && entry.role !== "system") ||
          entry.type === "custom_message" ||
          entry.type === "branch_summary",
      );
      return new SessionHistory(file, sessionId, messages, prompts);
    } finally {
      await handle.close();
    }
  }

  private position(id: string): number {
    const position = this.entries.findIndex((entry) => entry.id === id);
    if (position === -1)
      throw new Error("That saved message is no longer in this history. Reload the thread.");
    return position;
  }

  private async withFile<T>(read: (handle: FileHandle) => Promise<T>): Promise<T> {
    const handle = await open(this.file, "r");
    try {
      const buffer = Buffer.alloc(PREFIX_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const header = metadata(buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]!);
      if (header?.id !== this.sessionId)
        throw new Error("The saved history identity changed. Reload the thread.");
      return await read(handle);
    } finally {
      await handle.close();
    }
  }

  async preview(id: string): Promise<HistoryPreview> {
    const start = this.position(id);
    return this.withFile(async (handle) => {
      const first = this.entries[start]!;
      let prompt = "Large saved prompt";
      if (first.bytes <= HISTORY_PAGE_BYTES) {
        const value = await readEntry(handle, first);
        prompt = record(value.message) ? historyText(value.message.content) : "";
      }
      let end = start + 1;
      while (end < this.entries.length && this.entries[end]?.role !== "user") end++;
      let reply = "";
      let bytes = 0;
      for (let at = end - 1, scanned = 0; at > start && scanned < 32; at--, scanned++) {
        const entry = this.entries[at]!;
        if (entry.role !== "assistant") continue;
        bytes += entry.bytes;
        if (bytes > HISTORY_PAGE_BYTES) break;
        // oxlint-disable-next-line eslint/no-await-in-loop -- stop at the first textual reply, with a byte and record budget.
        const value = await readEntry(handle, entry);
        if (record(value.message)) reply = historyText(value.message.content);
        if (reply) break;
      }
      return { prompt: prompt || "Image or attachment", reply: reply || "No reply preview" };
    });
  }

  async page(id: string): Promise<HistoryPage> {
    const start = this.position(id);
    return this.withFile(async (handle) => {
      const messages: PiMessage[] = [];
      let bytes = 0;
      let at = start;
      for (; at < this.entries.length && messages.length < HISTORY_PAGE_MESSAGES; at++) {
        const entry = this.entries[at]!;
        if (entry.bytes <= HISTORY_PAGE_BYTES && bytes + entry.bytes > HISTORY_PAGE_BYTES) break;
        if (entry.bytes > HISTORY_PAGE_BYTES) {
          messages.push({
            role: "custom",
            customType: "history-limit",
            display: true,
            content: "This saved message exceeds the 1 MiB browsing limit and was not loaded.",
            timestamp: 0,
          });
          continue;
        }
        bytes += entry.bytes;
        // oxlint-disable-next-line eslint/no-await-in-loop -- one bounded page, in saved order.
        const value = await readEntry(handle, entry);
        const message = toMessage(value);
        if (message) messages.push(message);
      }
      let previous = start;
      let previousBytes = 0;
      while (previous > 0 && start - previous < HISTORY_PAGE_MESSAGES) {
        const size = this.entries[previous - 1]!.bytes;
        const loaded = size > HISTORY_PAGE_BYTES ? 0 : size;
        if (previousBytes + loaded > HISTORY_PAGE_BYTES) break;
        previousBytes += loaded;
        previous--;
      }
      return {
        messages,
        previous: previous === start ? null : this.entries[previous]!.id,
        next: this.entries[at]?.id ?? null,
      };
    });
  }
}

async function readEntry(handle: FileHandle, entry: Entry): Promise<RecordValue> {
  const buffer = Buffer.alloc(entry.bytes);
  let read = 0;
  while (read < buffer.length) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a regular-file read may return fewer bytes than requested.
    const { bytesRead } = await handle.read(
      buffer,
      read,
      buffer.length - read,
      entry.offset + read,
    );
    if (bytesRead === 0)
      throw new Error("The saved history changed while reading it. Reload the thread.");
    read += bytesRead;
  }
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("The saved history changed or contains an invalid record. Reload the thread.");
  }
  if (!record(value) || value.id !== entry.id)
    throw new Error("The saved history changed. Reload the thread.");
  return value;
}

function toMessage(entry: RecordValue): PiMessage | null {
  if (entry.type === "message") {
    if (messageProblem(entry.message)) throw new Error("A saved history message is invalid.");
    return entry.message as PiMessage;
  }
  if (entry.type === "custom_message")
    return {
      role: "custom",
      customType: String(entry.customType),
      content: (entry.content ?? "") as string,
      display: entry.display === true,
      details: entry.details,
      timestamp: Date.parse(String(entry.timestamp)),
    };
  if (entry.type === "branch_summary")
    return {
      role: "branchSummary",
      summary: String(entry.summary ?? ""),
      fromId: String(entry.fromId ?? ""),
      timestamp: Date.parse(String(entry.timestamp)),
    };
  return null;
}
