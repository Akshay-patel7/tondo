// Text-only prompt recall follows T3 Code's
// apps/web/src/components/chat/composerPromptHistory.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { PiMessage } from "../../shared/thread";

export interface HistoryPosition {
  /** Index in the transcript, which only grows while this thread stays open. */
  readonly index: number;
  readonly text: string;
}

/** User prompts, oldest first, with consecutive duplicates collapsed. Images aren't recalled. */
export function promptHistory(messages: readonly PiMessage[]): HistoryPosition[] {
  const entries: HistoryPosition[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    if (!text.trim()) return;
    if (entries.at(-1)?.text === text) entries.pop();
    entries.push({ index, text });
  });
  return entries;
}

/**
 * Up starts from an empty composer. Down past the newest prompt restores
 * that empty draft. Editing a recalled prompt ends browsing, so arrows can
 * move through the edited text normally.
 */
export function stepHistory(
  entries: readonly HistoryPosition[],
  position: HistoryPosition | null,
  text: string,
  direction: "backward" | "forward",
): { position: HistoryPosition | null; text: string } | null {
  const current =
    position?.text === text ? entries.findIndex((entry) => entry.index === position.index) : -1;
  if (direction === "backward") {
    if (current < 0 && text !== "") return null;
    const previous = entries[current < 0 ? entries.length - 1 : current - 1];
    return previous ? { position: previous, text: previous.text } : null;
  }
  if (current < 0) return null;
  const next = entries[current + 1];
  return { position: next ?? null, text: next?.text ?? "" };
}
