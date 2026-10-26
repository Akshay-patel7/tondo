// Prompt/reply navigation follows T3 Code's chat/timelineMinimapItems.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { historyText } from "../../shared/history";
import type { AssistantMessage } from "../../shared/thread";
import type { TimelineRow, UserMessage } from "./turns";

export interface NavigationTarget {
  readonly index: number;
  readonly prompt: UserMessage;
  readonly replies: readonly AssistantMessage[];
}

/** Index references, not text. Called only when completed messages change. */
export function navigationTargets(rows: readonly TimelineRow[]): readonly NavigationTarget[] {
  const targets: NavigationTarget[] = [];
  let prompt: Extract<TimelineRow, { kind: "user" }> | undefined;
  let replies: AssistantMessage[] = [];
  const finish = () => {
    if (prompt) targets.push({ index: prompt.start, prompt: prompt.message, replies });
  };
  for (const row of rows) {
    if (row.kind === "user") {
      finish();
      prompt = row;
      replies = [];
    } else if (row.kind === "assistant" && prompt) {
      for (const message of row.messages) replies.push(message);
    }
  }
  finish();
  return targets;
}

/** Only the hovered/focused turn gets a preview; never parse Markdown here. */
export function navigationPreview(target: NavigationTarget): { prompt: string; reply: string } {
  let reply = "";
  // Prefer the last textual response, but do not walk an unbounded tool history.
  for (
    let index = target.replies.length - 1;
    index >= Math.max(0, target.replies.length - 32);
    index--
  ) {
    const message = target.replies[index];
    if (message) reply = historyText(message.content);
    if (reply) break;
  }
  return {
    prompt: historyText(target.prompt.content) || "Image or attachment",
    reply: reply || "No reply preview",
  };
}

/** A bounded tick rail can still point at every prompt in a large thread. */
export function navigationIndex(fraction: number, count: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * Math.max(0, count - 1));
}
