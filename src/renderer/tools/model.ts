// What a tool card shows about a call, worked out from pi's messages. The
// built-in tools' arguments and results are the ones pi 0.87.1 documents and
// sends. Anything else is a tool from an extension, and its card shows the
// arguments and result as they are.
import type {
  AssistantMessage,
  PiMessage,
  ToolOutput,
  ToolResultMessage,
  ToolRun,
} from "../../shared/thread";

export type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

const resultIndexes = new WeakMap<readonly PiMessage[], ReadonlyMap<string, ToolResultMessage>>();

/**
 * Each tool result message by the id of the call it answers. The index is
 * built once for each messages array, since pi only appends to it.
 */
export function toolResults(
  messages: readonly PiMessage[],
): ReadonlyMap<string, ToolResultMessage> {
  let index = resultIndexes.get(messages);
  if (!index) {
    const byCall = new Map<string, ToolResultMessage>();
    for (const message of messages) {
      if (message.role === "toolResult") byCall.set(message.toolCallId, message);
    }
    index = byCall;
    resultIndexes.set(messages, index);
  }
  return index;
}

/**
 * The indexes of the messages the timeline shows as rows. A tool result
 * shows inside its call's card, so it gets no row of its own, unless its
 * call isn't in the transcript.
 */
export function timelineRows(messages: readonly PiMessage[]): number[] {
  const calls = new Set<string>();
  const rows: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
    } else if (message.role === "toolResult" && calls.has(message.toolCallId)) {
      return;
    }
    rows.push(index);
  });
  return rows;
}

/**
 * Where a call stands. `writing` while the model still writes the call,
 * `waiting` until pi starts it, and `stopped` if pi stopped before it ended.
 */
export type CallStatus = "writing" | "waiting" | "running" | "done" | "failed" | "stopped";

export function callStatus({
  writing,
  result,
  run,
  piWorking,
}: {
  /** Whether the message holding the call is still streaming. */
  writing: boolean;
  result: ToolResultMessage | undefined;
  run: ToolRun | undefined;
  /** Whether pi is between agent_start and agent_settled. */
  piWorking: boolean;
}): CallStatus {
  if (result) return result.isError ? "failed" : "done";
  if (run?.result) return run.isError ? "failed" : "done";
  if (run) return "running";
  if (writing) return "writing";
  return piWorking ? "waiting" : "stopped";
}

/** The call's result, or while it runs, the latest output it sent. */
export function callOutput(
  result: ToolResultMessage | undefined,
  run: ToolRun | undefined,
): ToolOutput | null {
  return result ?? run?.result ?? run?.partial ?? null;
}

/** Whether any of the output is an image. */
export function hasImage(output: ToolOutput): boolean {
  return output.content.some((part) => part.type === "image");
}

/** The text a tool returned, with a placeholder for each image. */
export function outputText(content: ToolOutput["content"]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : `[image: ${part.mimeType}]`))
    .join("\n");
}

/** The last `count` lines of `text`, without a trailing empty line. */
export function lastLines(text: string, count: number): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.slice(-count).join("\n");
}

/** Counts the lines a single-file unified patch adds and removes. */
export function patchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    // The ---/+++ file header comes before the first hunk, and a removed line
    // that starts with "--" looks just like it.
    if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/**
 * pi's read ends a partial read with a note on how to read on, such as
 * "[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]". The note
 * isn't part of the file.
 */
export function splitReadNote(text: string): { body: string; note: string | null } {
  const match = /\n\n(\[[^\n]*Use offset=\d+ to continue\.\])$/.exec(text);
  if (!match) return { body: text, note: null };
  return { body: text.slice(0, match.index), note: match[1]! };
}

/** What a card's header says about a call after the tool's name. */
export interface CallSummary {
  /** The command, path or pattern. */
  readonly subject: string;
  /** A short qualifier, such as the lines a read covers. */
  readonly detail: string | null;
}

/** An argument the model sent, if it's a string. Models can send anything. */
function stringArg(args: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The lines a read covers, as pi counts them: offset is the first line, from 1. */
function readRange(offset: number | undefined, limit: number | undefined): string | null {
  if (offset === undefined && limit === undefined) return null;
  const first = Math.max(1, offset ?? 1);
  if (limit === undefined) return `from line ${first}`;
  return `lines ${first}–${first + Math.max(1, limit) - 1}`;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

/** A header shows one line, so a longer subject is cut, and a huge one can't stall layout. */
export const MAX_SUBJECT_CHARS = 500;

export function summarizeCall(call: ToolCall): CallSummary {
  const summary = summarizeArguments(call);
  if (summary.subject.length <= MAX_SUBJECT_CHARS) return summary;
  return { ...summary, subject: `${summary.subject.slice(0, MAX_SUBJECT_CHARS)}…` };
}

function summarizeArguments(call: ToolCall): CallSummary {
  const args = call.arguments as Record<string, unknown>;
  const path = stringArg(args, "path", "file_path");
  switch (call.name) {
    case "bash":
    case "powershell":
      return { subject: stringArg(args, "command") ?? "", detail: null };
    case "read":
      return {
        subject: path ?? "",
        detail: readRange(numberArg(args, "offset"), numberArg(args, "limit")),
      };
    case "edit":
      return { subject: path ?? "", detail: null };
    case "write": {
      const content = stringArg(args, "content");
      if (content === undefined) return { subject: path ?? "", detail: null };
      const lines = lineCount(content);
      return { subject: path ?? "", detail: `${lines} ${lines === 1 ? "line" : "lines"}` };
    }
    case "grep":
    case "find": {
      const within = path ?? stringArg(args, "glob");
      return { subject: stringArg(args, "pattern") ?? "", detail: within ? `in ${within}` : null };
    }
    case "ls":
      return { subject: path ?? ".", detail: null };
    default:
      return { subject: compactJson(args), detail: null };
  }
}

/** Arguments on one line, for a header that truncates them. */
function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Arguments for a generic card's body, one field per line. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** Whether the model sent `path` as a string, so a file view can name the file. */
export function callPath(call: ToolCall): string | undefined {
  return stringArg(call.arguments as Record<string, unknown>, "path", "file_path");
}

/** What write's call asks pi to write. */
export function writeContent(call: ToolCall): string | undefined {
  return stringArg(call.arguments as Record<string, unknown>, "content");
}

/** Whether a read starts at the file's first line, so a file view's line numbers are right. */
export function readsFromStart(call: ToolCall): boolean {
  const offset = numberArg(call.arguments as Record<string, unknown>, "offset");
  return offset === undefined || offset <= 1;
}

/** The unified patch edit reports in its result details. */
export function editPatch(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const { patch } = details as { patch?: unknown };
  return typeof patch === "string" && patch !== "" ? patch : undefined;
}
