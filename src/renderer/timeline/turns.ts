// The timeline's rows and what an assistant turn shows. A row is a user
// message, an assistant turn, or a tool result whose call isn't in the
// transcript. A turn runs from an assistant message to the next user message
// and takes in the tool results between, so one work log can group the
// tool calls of the whole turn, however many messages the model wrote.
import type { AssistantMessage, PiMessage, ToolResultMessage } from "../../shared/thread";
import {
  editPatch,
  lineCount,
  patchStats,
  toolResults,
  writeContent,
  type ToolCall,
} from "../tools/model";

export type UserMessage = Extract<PiMessage, { role: "user" }>;

export type TimelineRow =
  | {
      readonly kind: "user";
      readonly start: number;
      readonly end: number;
      readonly message: UserMessage;
    }
  | {
      readonly kind: "toolResult";
      readonly start: number;
      readonly end: number;
      readonly message: ToolResultMessage;
    }
  | {
      readonly kind: "assistant";
      readonly start: number;
      /** The index after the turn's last message, results included. */
      readonly end: number;
      readonly messages: readonly AssistantMessage[];
    };

interface Rows {
  readonly list: readonly TimelineRow[];
  readonly byStart: ReadonlyMap<number, TimelineRow>;
}

const rowsByMessages = new WeakMap<readonly PiMessage[], Rows>();
/** The last array indexed, which the next one usually extends. */
let previous: { readonly messages: readonly PiMessage[]; readonly rows: Rows } | undefined;

/**
 * The rows for `messages`, built once per array. pi only appends, so a row
 * from the array before keeps its object as long as nothing was added to
 * it: a row that renders it then skips the re-render.
 */
function rowsOf(messages: readonly PiMessage[]): Rows {
  const cached = rowsByMessages.get(messages);
  if (cached) return cached;
  const kept = previous && extendsArray(messages, previous.messages) ? previous.rows : undefined;
  const rows = buildRows(messages, kept);
  rowsByMessages.set(messages, rows);
  previous = { messages, rows };
  return rows;
}

function extendsArray(next: readonly PiMessage[], before: readonly PiMessage[]): boolean {
  return next.length >= before.length && before.every((message, index) => next[index] === message);
}

function buildRows(messages: readonly PiMessage[], kept: Rows | undefined): Rows {
  const list: TimelineRow[] = [];
  const calls = new Set<string>();
  let turn: { start: number; messages: AssistantMessage[] } | null = null;
  const keep = (row: TimelineRow): TimelineRow => {
    const before = kept?.byStart.get(row.start);
    return before && before.kind === row.kind && before.end === row.end ? before : row;
  };
  const endTurn = (end: number) => {
    if (!turn) return;
    list.push(keep({ kind: "assistant", start: turn.start, end, messages: turn.messages }));
    turn = null;
  };
  messages.forEach((message, index) => {
    switch (message.role) {
      case "user":
        endTurn(index);
        list.push(keep({ kind: "user", start: index, end: index + 1, message }));
        break;
      case "assistant":
        for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
        turn ??= { start: index, messages: [] };
        turn.messages.push(message);
        break;
      case "toolResult":
        // A result shows in its call's work log row, not as a row of its own.
        if (calls.has(message.toolCallId)) break;
        endTurn(index);
        list.push(keep({ kind: "toolResult", start: index, end: index + 1, message }));
        break;
      default:
        break;
    }
  });
  endTurn(messages.length);
  return { list, byStart: new Map(list.map((row) => [row.start, row])) };
}

/** The rows the timeline shows for `messages`, in order. */
export function timelineRows(messages: readonly PiMessage[]): readonly TimelineRow[] {
  return rowsOf(messages).list;
}

/** The row that starts at message `start`, if one does. */
export function rowAt(messages: readonly PiMessage[], start: number): TimelineRow | undefined {
  return rowsOf(messages).byStart.get(start);
}

/**
 * Where the message pi is writing shows: in the last turn when it continues
 * one, as a reply after tool results does, or in a new row after the last
 * message. The finished message lands in the same row, so nothing remounts.
 */
export function streamingRowStart(
  messages: readonly PiMessage[],
  streaming: AssistantMessage | null,
): number | null {
  if (!streaming) return null;
  const last = rowsOf(messages).list.at(-1);
  return last?.kind === "assistant" ? last.start : messages.length;
}

/** A call in a work log, and whether the model is still writing it. */
export interface WorkLogCall {
  readonly call: ToolCall;
  readonly writing: boolean;
}

/** One part of an assistant turn's stack, top to bottom. */
export type StackItem =
  | {
      readonly kind: "thought";
      readonly key: string;
      readonly text: string;
      /** The model is still thinking this. */
      readonly active: boolean;
    }
  | {
      readonly kind: "text";
      readonly key: string;
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "workLog";
      /** The first call's id, which names the log in the collapsed-state store. */
      readonly key: string;
      readonly calls: readonly WorkLogCall[];
      /** The stamp of the message that made the first call. */
      readonly startedAt: number;
    }
  | { readonly kind: "error"; readonly key: string; readonly text: string };

/**
 * What a turn shows: its thinking, text and errors in order, with each run
 * of tool calls grouped into one work log, across messages. `streaming` is
 * the message pi is still writing, if it belongs to this turn.
 */
export function turnStack(
  messages: readonly AssistantMessage[],
  streaming: AssistantMessage | null,
): StackItem[] {
  const items: StackItem[] = [];
  let log: { key: string; calls: WorkLogCall[]; startedAt: number } | null = null;
  const endLog = () => {
    if (log) items.push({ kind: "workLog", ...log });
    log = null;
  };
  const all = streaming ? [...messages, streaming] : messages;
  all.forEach((message, index) => {
    const writing = message === streaming;
    message.content.forEach((block, blockIndex) => {
      const key = `${index}:${blockIndex}`;
      switch (block.type) {
        case "thinking":
          endLog();
          items.push({
            kind: "thought",
            key,
            text: block.thinking,
            active: writing && blockIndex === message.content.length - 1,
          });
          break;
        case "text":
          endLog();
          items.push({ kind: "text", key, text: block.text, streaming: writing });
          break;
        case "toolCall":
          log ??= { key: block.id, calls: [], startedAt: message.timestamp };
          log.calls.push({ call: block, writing });
          break;
        default:
          break;
      }
    });
    if (!writing && (message.stopReason === "error" || message.stopReason === "aborted")) {
      endLog();
      items.push({
        kind: "error",
        key: `${index}:error`,
        text: message.errorMessage ?? message.stopReason,
      });
    }
  });
  endLog();
  return items;
}

/** What a turn's edits and writes changed, for its summary row. */
export interface TurnChanges {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

const changesByTurn = new WeakMap<readonly AssistantMessage[], TurnChanges | null>();

/**
 * The files a turn changed and the lines it added and removed, counted from
 * the edits and writes that succeeded: an edit's patch, and a write's
 * content, which replaces whatever the file held. Null for a turn that
 * changed nothing. Equal counts keep the same object, so a selector that
 * returns it only re-renders when the counts change.
 */
export function turnChanges(
  messages: readonly AssistantMessage[],
  all: readonly PiMessage[],
): TurnChanges | null {
  const results = toolResults(all);
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== "toolCall" || (block.name !== "edit" && block.name !== "write")) continue;
      const result = results.get(block.id);
      if (!result || result.isError) continue;
      const path = stringPath(block);
      if (path !== undefined) files.add(path);
      if (block.name === "edit") {
        const patch = editPatch(result.details);
        if (patch === undefined) continue;
        const stats = patchStats(patch);
        additions += stats.additions;
        deletions += stats.deletions;
      } else {
        additions += lineCount(writeContent(block) ?? "");
      }
    }
  }
  const changes = files.size === 0 ? null : { files: files.size, additions, deletions };
  const before = changesByTurn.get(messages);
  if (
    before !== undefined &&
    (before === changes ||
      (before !== null &&
        changes !== null &&
        before.files === changes.files &&
        before.additions === changes.additions &&
        before.deletions === changes.deletions))
  ) {
    return before;
  }
  changesByTurn.set(messages, changes);
  return changes;
}

function stringPath(call: ToolCall): string | undefined {
  const { path } = call.arguments as { path?: unknown };
  return typeof path === "string" ? path : undefined;
}

/**
 * The checkpoint turn that was running at `at`, a message's stamp: the host
 * records a turn's start before it sends the prompt, so a turn's messages
 * all stamp later than its start and earlier than the next turn's.
 */
export function checkpointTurnAt(
  turns: readonly { readonly turn: number; readonly startedAt: number }[],
  at: number | undefined,
): number | undefined {
  if (at === undefined) return undefined;
  let found: number | undefined;
  for (const turn of turns) {
    if (turn.startedAt <= at) found = turn.turn;
  }
  return found;
}
