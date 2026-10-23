import type { ToolOutput } from "../../shared/thread";
import { stripAnsi } from "../banners/ansi";
import { lastLines, type CallStatus, type ToolCall } from "./model";

export interface CallPreview {
  kind: "output" | "error" | "diff";
  text: string;
  live: boolean;
  more: boolean;
}

const PREVIEW_LINES = 3;
const LIVE_LINES = 5;
const LINE_CHARS = 240;
const SCAN_CHARS = 4_096;

/** Bound work before joining blocks, stripping ANSI, or splitting lines. */
function outputExcerpt(output: ToolOutput, tail: boolean): { text: string; more: boolean } {
  let text = "";
  let index = tail ? output.content.length - 1 : 0;
  const step = tail ? -1 : 1;
  for (; index >= 0 && index < output.content.length; index += step) {
    const block = output.content[index]!;
    const value = block.type === "text" ? block.text : `[image: ${block.mimeType}]`;
    const separator = text ? "\n" : "";
    const remaining = SCAN_CHARS - text.length - separator.length;
    if (remaining <= 0) return { text: stripAnsi(text), more: true };
    const part = tail ? value.slice(-remaining) : value.slice(0, remaining);
    text = tail ? part + separator + text : text + separator + part;
    if (value.length > remaining) return { text: stripAnsi(text), more: true };
  }
  return { text: stripAnsi(text), more: false };
}

/** Small, plain-text excerpts only. Opening a row still shows the original full result. */
export function callPreview({
  call,
  status,
  output,
  patch,
}: {
  call: ToolCall;
  status: CallStatus;
  output: ToolOutput | null;
  patch: string | undefined;
}): CallPreview | null {
  const shell = call.name === "bash" || call.name === "powershell";
  const live = shell && status === "running";
  if (!output || (!live && status !== "done" && status !== "failed")) return null;
  // File reads and writes already name their target and size. Don't fill the log with source.
  if (status !== "failed" && (call.name === "read" || call.name === "write" || call.name === "ls"))
    return null;

  let kind: CallPreview["kind"] = "output";
  if (status === "failed") kind = "error";
  else if (call.name === "edit" && patch) kind = "diff";
  const excerpt =
    kind === "diff" && patch
      ? { text: patch.slice(0, SCAN_CHARS), more: patch.length > SCAN_CHARS }
      : outputExcerpt(output, shell);
  const { text } = excerpt;
  const count = live ? LIVE_LINES : PREVIEW_LINES;
  let lines: string[];
  if (kind === "diff") {
    // Keep hunk locations and changed lines, never file headers or unrelated context.
    let inHunk = false;
    lines = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("@@")) inHunk = true;
      if (inHunk && /^(?:@@|[+-])/.test(line)) lines.push(line);
      if (lines.length > count) break;
    }
  } else {
    const trimmed = text.trim();
    if (!trimmed) return null;
    lines = (shell ? lastLines(trimmed, count + 1) : trimmed).split(
      "\n",
      shell ? undefined : count + 1,
    );
  }
  if (lines.length === 0) return null;
  const shown = shell ? lines.slice(-count) : lines.slice(0, count);
  const more =
    excerpt.more || lines.length > count || shown.some((line) => line.length > LINE_CHARS);
  return {
    kind,
    text: shown
      .map((line) => {
        if (line.length <= LINE_CHARS) return line;
        return shell ? `…${line.slice(-LINE_CHARS)}` : `${line.slice(0, LINE_CHARS)}…`;
      })
      .join("\n"),
    live,
    more,
  };
}
