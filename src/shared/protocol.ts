// The messages that cross between the page, the host and main. The page and
// the host talk over a MessagePort that main hands them on each page load.
// The page renders content from pi and the web, so the host checks every
// message the page sends with parseClientMessage before acting on it.
import type { ContextUsage, RpcSessionState } from "@earendil-works/pi-coding-agent";
import type { PiEvent, ThreadState } from "./thread";

/** Bump it when a message between the page and the host changes shape. */
export const PROTOCOL_VERSION = 2;

/** Main sends the preload the page's port on this channel, and the preload passes it on as this message. */
export const PORT_MESSAGE = "tondo:port";

export type ThinkingLevel = RpcSessionState["thinkingLevel"];

/** How a message you send while pi works joins its queue: Enter steers, Alt+Enter follows up. */
export type StreamingBehavior = "steer" | "followUp";

/** A model from pi's get_available_models. */
export interface ModelOption {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}

/** What a running pi last said about its model, thinking level and context. */
export interface PiSession {
  /** The model get_state reports, or null if pi has none. */
  readonly model: { readonly provider: string; readonly id: string } | null;
  /** The models you have credentials for. */
  readonly models: readonly ModelOption[];
  readonly thinkingLevel: ThinkingLevel;
  /** The levels the current model supports. */
  readonly thinkingLevels: readonly ThinkingLevel[];
  /** From get_session_stats. Null while the model or its context window is unknown. */
  readonly context: ContextUsage | null;
}

export type PiStatus =
  /** No project is open, or Tondo is waiting for your answer about trusting it. */
  | { readonly state: "stopped" }
  | { readonly state: "starting" }
  | { readonly state: "ready"; readonly session: PiSession }
  /** pi exited or couldn't start, for the reason in `error`. You can restart it. */
  | { readonly state: "exited"; readonly error: string };

/** The open project and its pi. The host sends it whole whenever it changes. */
export interface Workspace {
  /** The project folder, or null until you open one. */
  readonly project: string | null;
  /** Whether Tondo is waiting to hear if pi may load the project's own settings and extensions. */
  readonly askingTrust: boolean;
  readonly pi: PiStatus;
}

type Versioned<T> = T & { readonly v: typeof PROTOCOL_VERSION };

/** What the page asks of the host. */
export type ClientMessage = Versioned<
  /** Ask for a folder and start a thread there. */
  | { type: "open-project" }
  /** Your answer to whether to trust the project. */
  | { type: "trust"; trusted: boolean }
  /** Send `text` to pi. While pi works it joins the queue the way `streamingBehavior` says. */
  | { type: "prompt"; text: string; streamingBehavior: StreamingBehavior }
  /** Escape: take pi's queue back into the composer, then stop pi. */
  | { type: "stop" }
  /** Alt+Up: take pi's queue back into the composer. */
  | { type: "dequeue" }
  | { type: "set-model"; provider: string; modelId: string }
  | { type: "set-thinking-level"; level: ThinkingLevel }
  /** Start pi again after it exited. */
  | { type: "restart" }
  /** Send the whole thread again. It stands in for switching to it until Stage 5. */
  | { type: "reopen" }
  | { type: "ping"; id: number }
>;

/** What the host sends the page. */
export type HostMessage = Versioned<
  /** The workspace and the whole thread. The host sends it to each new port, when a thread opens, and on reopen. */
  | { type: "snapshot"; workspace: Workspace; thread: ThreadState }
  /** Events that came due since the last batch, already applied to the host's thread. */
  | { type: "events"; events: PiEvent[] }
  | { type: "workspace"; workspace: Workspace }
  /** Text for the composer: messages taken back from pi's queue, or a prompt pi didn't take. */
  | { type: "restore"; text: string }
  | { type: "pong"; id: number }
  | { type: "error"; message: string }
>;

/**
 * What main sends the host. `connect` carries the host's end of a new page
 * port. Main and the host come from the same build, so these aren't versioned.
 */
export type MainToHostMessage =
  | { type: "connect" }
  | { type: "collect-garbage" }
  /** The folder you picked in the dialog `choose-project` asked for, or null if you cancelled. */
  | { type: "project-chosen"; folder: string | null };

/** What main tells the host as it forks it, as JSON in the host's first argument. */
export interface HostConfig {
  /** Tondo's app data folder, which holds settings.json. */
  userData: string;
  /** PI_CODING_AGENT_DIR for every pi. Unpackaged runs set it so they leave ~/.pi/agent alone. */
  piAgentDir?: string;
  /** Arguments added to every pi's command line. Unpackaged runs take them from TONDO_PI_ARGS. */
  piArgs: string[];
}

/** What the host sends main. */
export type HostToMainMessage =
  /** The host is listening, so main can connect a page. */
  | { type: "ready" }
  /** Every process group the host started. Main kills them if the host dies. */
  | { type: "process-groups"; pgids: number[] }
  | { type: "garbage-collected" }
  /** Show the folder dialog and answer with project-chosen. */
  | { type: "choose-project" };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

/**
 * Checks a message from the page and returns a fresh copy of it. Anything
 * that isn't exactly one of the ClientMessage shapes is rejected with a
 * reason, and hostile values never make it throw. The host still checks
 * that a model or thinking level is one pi offered.
 */
export function parseClientMessage(data: unknown): ParseResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return invalid(`a message must be an object, not ${describe(data)}`);
  }
  const message = data as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION) {
    return invalid(`protocol version ${describe(message.v)} isn't ${PROTOCOL_VERSION}`);
  }
  const v = PROTOCOL_VERSION;
  switch (message.type) {
    case "open-project":
      return exactly(message, { v, type: "open-project" });
    case "trust": {
      const { trusted } = message;
      if (typeof trusted !== "boolean") {
        return invalid(`trust: trusted must be true or false, not ${describe(trusted)}`);
      }
      return exactly(message, { v, type: "trust", trusted });
    }
    case "prompt": {
      const { text, streamingBehavior } = message;
      if (typeof text !== "string" || !text.trim()) {
        return invalid(`prompt: text must be a string that isn't blank, not ${describe(text)}`);
      }
      if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") {
        return invalid(
          `prompt: streamingBehavior must be "steer" or "followUp", not ${describe(streamingBehavior)}`,
        );
      }
      return exactly(message, { v, type: "prompt", text, streamingBehavior });
    }
    case "stop":
      return exactly(message, { v, type: "stop" });
    case "dequeue":
      return exactly(message, { v, type: "dequeue" });
    case "set-model": {
      const { provider, modelId } = message;
      if (typeof provider !== "string" || typeof modelId !== "string") {
        return invalid(
          `set-model: provider and modelId must be strings, not ${describe(provider)} and ${describe(modelId)}`,
        );
      }
      return exactly(message, { v, type: "set-model", provider, modelId });
    }
    case "set-thinking-level": {
      const { level } = message;
      if (typeof level !== "string") {
        return invalid(`set-thinking-level: level must be a string, not ${describe(level)}`);
      }
      // The host accepts only the levels pi offered for the current model.
      return exactly(message, { v, type: "set-thinking-level", level: level as ThinkingLevel });
    }
    case "restart":
      return exactly(message, { v, type: "restart" });
    case "reopen":
      return exactly(message, { v, type: "reopen" });
    case "ping": {
      const { id } = message;
      if (!Number.isSafeInteger(id)) {
        return invalid(`ping: id must be an integer, not ${describe(id)}`);
      }
      return exactly(message, { v, type: "ping", id: id as number });
    }
    default:
      return invalid(`unknown message type ${describe(message.type)}`);
  }
}

function invalid(error: string): ParseResult {
  return { ok: false, error };
}

/** Accepts `parsed` only if the page sent no fields beyond the ones it has. */
function exactly(sent: Record<string, unknown>, parsed: ClientMessage): ParseResult {
  const extra = Object.keys(sent).find((key) => !Object.hasOwn(parsed, key));
  if (extra !== undefined) return invalid(`${parsed.type}: unexpected field ${describe(extra)}`);
  return { ok: true, message: parsed };
}

/** Names an untrusted value for an error message without calling anything on it. */
function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}
