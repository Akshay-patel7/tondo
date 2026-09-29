// Reads pi's extension UI requests (pi's rpc-extension-ui.md) into what a
// thread's extensions show: dialogs waiting for an answer, status texts,
// widget lines and a window title. Extensions make these strings, so the host
// checks their shape and strips terminal color codes, which extensions get
// from pi's theme even in RPC mode.
import type { RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import type {
  DialogAnswer,
  ExtensionDialog,
  ExtensionUi,
  NotifyLevel,
  WidgetPlacement,
} from "../shared/protocol";
import type { PiRecord } from "./piRpc";

/** What one extension UI request asks for. */
export type UiRequest =
  /** `options` are pi's own select options, which an answer has to repeat exactly. */
  | { kind: "dialog"; dialog: ExtensionDialog; options: readonly string[] | null }
  /** A dialog Tondo can't show. The host cancels it so the extension doesn't wait for ever. */
  | { kind: "bad-dialog"; id: string }
  | { kind: "status"; key: string; text: string | null }
  | { kind: "widget"; key: string; lines: readonly string[] | null; placement: WidgetPlacement }
  | { kind: "title"; title: string }
  | { kind: "notify"; level: NotifyLevel; message: string }
  | { kind: "editor-text"; text: string }
  /** A method this version doesn't know, or a request that makes no sense. */
  | { kind: "ignored" };

const IGNORED: UiRequest = { kind: "ignored" };

/** Node runs a timer given under 1 ms or over 2^31 − 1 ms after 1 ms, and so does pi's dialog timeout. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Reads an extension_ui_request. `now` is when it arrived. pi starts a timed
 * dialog's clock just before it writes the request, so the dialog expires
 * `timeout` ms from then, give or take the time the line took to arrive.
 */
export function readUiRequest(record: PiRecord, now: number): UiRequest {
  const { id, method } = record;
  switch (method) {
    case "select":
    case "confirm":
    case "input":
    case "editor": {
      if (typeof id !== "string" || id === "") return IGNORED;
      const dialog = readDialog(id, method, record, now);
      return dialog ?? { kind: "bad-dialog", id };
    }
    case "setStatus": {
      const { statusKey, statusText } = record;
      if (typeof statusKey !== "string") return IGNORED;
      const text = typeof statusText === "string" ? stripAnsi(statusText) : "";
      return { kind: "status", key: statusKey, text: text === "" ? null : text };
    }
    case "setWidget": {
      const { widgetKey, widgetLines, widgetPlacement } = record;
      if (typeof widgetKey !== "string") return IGNORED;
      const placement = widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor";
      const lines = strings(widgetLines);
      return { kind: "widget", key: widgetKey, lines: lines?.map(stripAnsi) ?? null, placement };
    }
    case "setTitle":
      return typeof record.title === "string"
        ? { kind: "title", title: stripAnsi(record.title) }
        : IGNORED;
    case "notify": {
      const { message, notifyType } = record;
      if (typeof message !== "string") return IGNORED;
      const level = notifyType === "warning" || notifyType === "error" ? notifyType : "info";
      return { kind: "notify", level, message: stripAnsi(message) };
    }
    case "set_editor_text":
      return typeof record.text === "string" ? { kind: "editor-text", text: record.text } : IGNORED;
    default:
      return IGNORED;
  }
}

function readDialog(
  id: string,
  method: ExtensionDialog["method"],
  record: PiRecord,
  now: number,
): UiRequest | undefined {
  const { title, timeout } = record;
  if (typeof title !== "string") return undefined;
  // editor waits for ever: pi gives it no timeout.
  const expiresAt =
    method !== "editor" && typeof timeout === "number" && timeout
      ? now + (timeout >= 1 && timeout <= MAX_TIMER_MS ? timeout : 1)
      : null;
  const base = { id, title: stripAnsi(title), expiresAt };
  switch (method) {
    case "select": {
      const options = strings(record.options);
      if (!options || options.length === 0) return undefined;
      return {
        kind: "dialog",
        dialog: { ...base, method, options: options.map(stripAnsi) },
        options,
      };
    }
    case "confirm": {
      const message = optionalString(record.message);
      if (message === undefined) return undefined;
      return {
        kind: "dialog",
        dialog: { ...base, method, message: stripAnsi(message) },
        options: null,
      };
    }
    case "input": {
      const placeholder = optionalString(record.placeholder);
      if (placeholder === undefined) return undefined;
      return {
        kind: "dialog",
        dialog: { ...base, method, placeholder: stripAnsi(placeholder) },
        options: null,
      };
    }
    case "editor": {
      const prefill = optionalString(record.prefill);
      if (prefill === undefined) return undefined;
      // The prefill is the text you edit and send back, so it keeps its characters.
      return { kind: "dialog", dialog: { ...base, method, prefill }, options: null };
    }
  }
}

/** `ui` after a request that changes what's shown. It's the same object if nothing changed. */
export function applyUiRequest(ui: ExtensionUi, request: UiRequest): ExtensionUi {
  switch (request.kind) {
    case "dialog":
      return { ...ui, dialogs: [...ui.dialogs, request.dialog] };
    case "status": {
      const { key, text } = request;
      const statuses = setEntry(ui.statuses, key, text === null ? null : { key, text }, sameStatus);
      return statuses === ui.statuses ? ui : { ...ui, statuses };
    }
    case "widget": {
      const { key, lines, placement } = request;
      const widget = lines === null ? null : { key, lines, placement };
      const widgets = setEntry(ui.widgets, key, widget, sameWidget);
      return widgets === ui.widgets ? ui : { ...ui, widgets };
    }
    case "title":
      return ui.title === request.title ? ui : { ...ui, title: request.title };
    default:
      return ui;
  }
}

/**
 * The response that tells pi your answer to `dialog`. A select's answer is
 * the option as shown, and the response repeats pi's own option, which may
 * hold color codes. Throws if the answer doesn't fit the dialog.
 */
export function responseTo(
  dialog: ExtensionDialog,
  answer: DialogAnswer,
  options: readonly string[] | undefined,
): RpcExtensionUIResponse {
  const { id } = dialog;
  if ("cancelled" in answer) return { type: "extension_ui_response", id, cancelled: true };
  switch (dialog.method) {
    case "select": {
      const index = "value" in answer ? dialog.options.indexOf(answer.value) : -1;
      const value = options?.[index];
      if (value === undefined) throw new Error(`"${dialog.title}" has no option like that.`);
      return { type: "extension_ui_response", id, value };
    }
    case "confirm":
      if (!("confirmed" in answer)) throw new Error(`"${dialog.title}" needs a yes or no.`);
      return { type: "extension_ui_response", id, confirmed: answer.confirmed };
    case "input":
    case "editor":
      if (!("value" in answer)) throw new Error(`"${dialog.title}" needs text.`);
      return { type: "extension_ui_response", id, value: answer.value };
  }
}

/** `ui` without the dialog `id`. It's the same object if the dialog wasn't there. */
export function withoutDialog(ui: ExtensionUi, id: string): ExtensionUi {
  const dialogs = ui.dialogs.filter((dialog) => dialog.id !== id);
  return dialogs.length === ui.dialogs.length ? ui : { ...ui, dialogs };
}

/**
 * Sets, replaces or (with null) removes the entry for `key`. A new key goes
 * last and a replaced one keeps its place. Returns `list` if nothing changed.
 */
function setEntry<T extends { readonly key: string }>(
  list: readonly T[],
  key: string,
  entry: T | null,
  same: (a: T, b: T) => boolean,
): readonly T[] {
  const index = list.findIndex((existing) => existing.key === key);
  if (entry === null) return index === -1 ? list : list.filter((_, i) => i !== index);
  if (index === -1) return [...list, entry];
  return same(list[index]!, entry) ? list : list.with(index, entry);
}

function sameStatus(a: { text: string }, b: { text: string }): boolean {
  return a.text === b.text;
}

function sameWidget(
  a: { lines: readonly string[]; placement: WidgetPlacement },
  b: { lines: readonly string[]; placement: WidgetPlacement },
): boolean {
  return (
    a.placement === b.placement &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, index) => line === b.lines[index])
  );
}

/** `value` if it's an array of strings, else undefined. */
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

/** "" for a field pi left out, the string itself, or undefined if it's anything else. */
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return "";
  return typeof value === "string" ? value : undefined;
}

/**
 * Terminal escape sequences: CSI (colors, cursor moves), OSC (titles,
 * hyperlinks) ending in BEL or ST, and other two-character escapes.
 */
const ANSI =
  // oxlint-disable-next-line eslint/no-control-regex -- matching escape characters is the point.
  /\u001B\][\s\S]*?(?:\u0007|\u001B\\)|(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/g;

/** `text` without terminal escape sequences, which a page can't show. */
export function stripAnsi(text: string): string {
  return text.includes("\u001B") || text.includes("\u009B") ? text.replace(ANSI, "") : text;
}
