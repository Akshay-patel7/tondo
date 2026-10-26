// What a work log row shows about a call, worked out from pi's messages. The
// built-in tools' arguments and results are the ones pi 0.87.1 documents and
// sends. Extension summaries label arguments without guessing their purpose;
// the expanded row keeps the original arguments and result.
import type {
  AssistantMessage,
  PiMessage,
  ToolOutput,
  ToolResultMessage,
  ToolRun,
} from "../../shared/thread";
import { stripAnsi } from "../banners/ansi";

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
 * Where a call stands. `writing` while the model still writes the call,
 * `waiting` until pi starts it, and `stopped` if pi stopped before it ended.
 */
export type CallStatus =
  | "writing"
  | "waiting"
  | "running"
  | "done"
  | "failed"
  | "stopped"
  | "unloaded";

export function callStatus({
  writing,
  result,
  run,
  piWorking,
  historical = false,
}: {
  /** Whether the message holding the call is still streaming. */
  writing: boolean;
  result: ToolResultMessage | undefined;
  run: ToolRun | undefined;
  /** Whether pi is between agent_start and agent_settled. */
  piWorking: boolean;
  historical?: boolean;
}): CallStatus {
  if (result) return result.isError ? "failed" : "done";
  if (run?.result) return run.isError ? "failed" : "done";
  if (run) return "running";
  if (writing) return "writing";
  if (historical) return "unloaded";
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

/**
 * The text a tool returned, with a placeholder for each image. A command that
 * colors its output, such as git or a test runner, sends terminal escape
 * sequences with it, which a page would show as stray text like "[31m", so
 * they go.
 */
export function outputText(
  content: ToolOutput["content"],
  { imageLabels = true }: { imageLabels?: boolean } = {},
): string {
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text") parts.push(part.text);
    else if (imageLabels) parts.push(`[image: ${part.mimeType}]`);
  }
  return stripAnsi(parts.join("\n"));
}

/** The last `count` lines of `text`, without a trailing empty line. */
export function lastLines(text: string, count: number): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.slice(-count).join("\n");
}

/**
 * The figure at the end of a work log row: a count of what the call found or
 * changed, or a test runner's verdict. Counts come from the call's real
 * output, so a call that hasn't finished shows what its arguments say, if
 * anything, as the card's header did before.
 */
export type CallMeta =
  | { readonly kind: "text"; readonly text: string; readonly tone: "faint" | "success" | "failure" }
  | { readonly kind: "stats"; readonly additions: number; readonly deletions: number };

type TextMeta = Extract<CallMeta, { kind: "text" }>;

function faint(text: string | null): TextMeta | null {
  return text === null ? null : { kind: "text", text, tone: "faint" };
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The lines of a listing, without pi's bracketed notices and its "nothing found" line. */
function listedLines(text: string): number {
  return text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("[") && !line.startsWith("No ")).length;
}

/** How many matches grep printed: one "path:line: text" line each. Context lines use "-". */
function grepMatches(text: string): number {
  return text.split("\n").filter((line) => /^.+:\d+: /.test(line)).length;
}

/** How many lines of a command's output to look at for a test runner's verdict. */
const VERDICT_LINES = 20;

/**
 * A test runner's verdict from the end of a command's output, such as
 * vitest's "Tests  42 passed (42)", jest's "Tests: 42 passed, 42 total",
 * pytest's "42 passed in 1.2s" or mocha's "42 passing". The last count wins,
 * since runners print their file totals before their test totals. A failure
 * count outranks a pass count.
 */
export function testVerdict(text: string): TextMeta | null {
  const tail = lastLines(text, VERDICT_LINES);
  const failed = [...tail.matchAll(/\b(\d+) (?:failed|failing)\b/g)].at(-1);
  if (failed && Number(failed[1]) > 0) {
    return { kind: "text", text: `${failed[1]} failed`, tone: "failure" };
  }
  const passed = [...tail.matchAll(/\b(\d+) (?:passed|passing)\b/g)].at(-1);
  return passed ? { kind: "text", text: `${passed[1]} passed`, tone: "success" } : null;
}

export function callMeta({
  call,
  status,
  output,
  patch,
}: {
  call: ToolCall;
  status: CallStatus;
  output: ToolOutput | null;
  /** The unified patch an edit reported, if it has. */
  patch: string | undefined;
}): CallMeta | null {
  const args = call.arguments;
  const finished = status === "done" && output !== null;
  switch (call.name) {
    case "edit":
      return patch === undefined ? null : { kind: "stats", ...patchStats(patch) };
    case "read": {
      if (!finished || hasImage(output))
        return faint(readRange(numberArg(args, "offset"), numberArg(args, "limit")));
      const lines = lineCount(splitReadNote(outputText(output.content)).body);
      return faint(counted(lines, "line", "lines"));
    }
    case "grep":
      return finished
        ? faint(counted(grepMatches(outputText(output.content)), "match", "matches"))
        : null;
    case "find":
      return finished
        ? faint(counted(listedLines(outputText(output.content)), "file", "files"))
        : null;
    case "ls":
      return finished
        ? faint(counted(listedLines(outputText(output.content)), "entry", "entries"))
        : null;
    case "bash":
    case "powershell":
      return finished ? testVerdict(outputText(output.content)) : null;
    case "write": {
      const content = writeContent(call);
      return content === undefined ? null : faint(counted(lineCount(content), "line", "lines"));
    }
    default:
      return null;
  }
}

/**
 * How long a work log's calls took, in milliseconds: from pi-ai stamping the
 * message that made the first call, which it does as the model starts it, to
 * pi stamping the last call's result. Null until every call has its result,
 * or if the stamps don't make sense, as when a transcript was written by
 * hand, so the header says only "Worked".
 */
export function workLogDuration(
  startedAt: unknown,
  calls: readonly ToolCall[],
  results: ReadonlyMap<string, ToolResultMessage>,
): number | null {
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  let end = startedAt;
  for (const call of calls) {
    const stamp: unknown = results.get(call.id)?.timestamp;
    if (typeof stamp !== "number" || !Number.isFinite(stamp) || stamp < startedAt) return null;
    end = Math.max(end, stamp);
  }
  return end - startedAt;
}

/** `ms` as the header shows it: whole seconds, rounded up, in s, m and h. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
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

/** A readable action, followed by the path, command or labelled arguments. */
export interface CallSummary {
  readonly title: string;
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

/** How many lines `text` has, not counting a final newline. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

/** Bound collapsed text before it reaches the DOM. Expanded inputs are never shortened. */
export const MAX_SUMMARY_CHARS = 500;

function summaryText(text: string): string {
  const singleLine = text.slice(0, MAX_SUMMARY_CHARS).replace(/\s+/g, " ").trim();
  return text.length > MAX_SUMMARY_CHARS ? `${singleLine}…` : singleLine;
}

export function summarizeCall(call: ToolCall): CallSummary {
  const summary = summarizeArguments(call);
  return {
    title: summaryText(summary.title),
    detail: summary.detail ? summaryText(summary.detail) : null,
  };
}

function basename(path: string): string {
  return path.split(/[/\\]/).findLast(Boolean) ?? path;
}

/** Only exact, simple commands get an action label. Never parse or guess at shell scripts. */
function commandTitle(command: string, shell: string): string {
  if (command.length > MAX_SUMMARY_CHARS) return `Run ${shell} command`;
  const match = /^(?:pnpm|npm|yarn|bun)(?: run)? (test|lint|typecheck|build)$/.exec(command.trim());
  switch (match?.[1]) {
    case "test":
      return "Run tests";
    case "lint":
      return "Run lint";
    case "typecheck":
      return "Check types";
    case "build":
      return "Build project";
    default:
      return `Run ${shell} command`;
  }
}

function readableName(name: string): string {
  const words = name.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function extensionTitle(name: string): string {
  if (!name.startsWith("mcp__")) return readableName(name);
  const [, server, ...tool] = name.split("__");
  return server && tool.length ? `${server} · ${readableName(tool.join(" "))}` : name;
}

/** Summarize containers, not their potentially huge contents. Keep scalar field names literal. */
function argumentValue(value: unknown): string {
  if (Array.isArray(value)) return counted(value.length, "item", "items");
  if (value !== null && typeof value === "object")
    return counted(Object.keys(value).length, "field", "fields");
  return summaryText(String(value));
}

function argumentSummary(args: Record<string, unknown>): string | null {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  const fields = entries.slice(0, 3).map(([key, value]) => `${key}: ${argumentValue(value)}`);
  if (entries.length > 3) fields.push(`+${entries.length - 3} more`);
  return fields.join(" · ");
}

function summarizeArguments(call: ToolCall): CallSummary {
  const args = call.arguments;
  const path = callPath(call);
  switch (call.name) {
    case "bash":
    case "powershell": {
      const command = stringArg(args, "command") ?? "";
      return { title: commandTitle(command, call.name), detail: command || null };
    }
    case "read": {
      const range = readRange(numberArg(args, "offset"), numberArg(args, "limit"));
      return {
        title: `Read ${path ? basename(path) : "file"}`,
        detail: [path, range ? `requested ${range}` : null].filter(Boolean).join(" · ") || null,
      };
    }
    case "edit":
      return { title: `Edit ${path ? basename(path) : "file"}`, detail: path ?? null };
    case "write":
      return { title: `Write ${path ? basename(path) : "file"}`, detail: path ?? null };
    case "grep":
    case "find": {
      const pattern = stringArg(args, "pattern");
      const action = call.name === "grep" ? "Search" : "Find files";
      const qualifier = call.name === "grep" ? "for" : "matching";
      const within = path ?? stringArg(args, "glob");
      return {
        title: pattern ? `${action} ${qualifier} "${pattern}"` : action,
        detail: within ? `In ${within}` : "In current directory",
      };
    }
    case "ls":
      return {
        title: path ? `List ${basename(path)}` : "List directory",
        detail: path ?? "Current directory",
      };
    default:
      return { title: extensionTitle(call.name), detail: argumentSummary(args) };
  }
}

/** Arguments for an extension tool's expanded row, one field per line. */
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
