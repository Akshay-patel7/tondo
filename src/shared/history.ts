import type { PiMessage } from "./thread";

/** Only compacted prompts cross the port at indexing time. No message bodies. */
export interface HistoryIndex {
  readonly revision: string;
  readonly prompts: readonly string[];
}

export interface HistoryPreview {
  readonly prompt: string;
  readonly reply: string;
}

/** One replaceable window, never an ever-growing transcript cache. */
export interface HistoryPage {
  readonly messages: readonly PiMessage[];
  readonly previous: string | null;
  readonly next: string | null;
}

export const HISTORY_PAGE_MESSAGES = 64;
export const HISTORY_PAGE_BYTES = 1024 * 1024;
export const HISTORY_PREVIEW_CHARS = 320;

/** Bound both scans and text before normalizing, including multi-megabyte inputs. */
export function historyText(content: unknown): string {
  if (typeof content === "string")
    return content.slice(0, HISTORY_PREVIEW_CHARS).replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content.slice(0, 32)) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    if (text) text += " ";
    text += block.text.slice(0, HISTORY_PREVIEW_CHARS - text.length);
    if (text.length >= HISTORY_PREVIEW_CHARS) break;
  }
  return text.replace(/\s+/g, " ").trim();
}
