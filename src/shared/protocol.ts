// The messages that cross between the page, the host and main. The page and
// the host talk over a MessagePort that main hands them on each page load.
// The page renders content from pi and the web, so the host checks every
// message the page sends with parseClientMessage before acting on it.
import type { ContextUsage, RpcSessionState } from "@earendil-works/pi-coding-agent";
import type { PiEvent, ThreadState } from "./thread";

/** Bump it when a message between the page and the host changes shape. */
export const PROTOCOL_VERSION = 3;

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
  /** Tondo is waiting for your answer about trusting the project before it starts pi. */
  | { readonly state: "stopped" }
  | { readonly state: "starting" }
  | { readonly state: "ready"; readonly session: PiSession }
  /** pi exited or couldn't start, for the reason in `error`. You can restart it. */
  | { readonly state: "exited"; readonly error: string };

/** What pi is doing in a thread, as the sidebar shows it. */
export type ThreadActivity = "idle" | "starting" | "working" | "error";

/** A thread as the sidebar lists it. */
export interface SidebarThread {
  /** pi's session id. */
  readonly id: string;
  readonly title: string;
  /** When the thread last had a message, in milliseconds since 1970. */
  readonly updatedAt: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly activity: ThreadActivity;
  /** Whether pi finished or failed in the thread since you last looked at it. */
  readonly unread: boolean;
  /** Whether the thread's composer holds text you haven't sent. */
  readonly hasDraft: boolean;
  /** pi saves a thread's name only once the thread has a reply, so you can rename it from then on. */
  readonly canRename: boolean;
}

export interface SidebarProject {
  readonly id: number;
  /** The project folder. */
  readonly path: string;
  /** Whether the sidebar hides the project's threads. */
  readonly collapsed: boolean;
  /** Its threads, archived ones too, pinned first and then the most recently updated. */
  readonly threads: readonly SidebarThread[];
}

/** The thread on screen and its pi. */
export interface OpenThread {
  readonly id: string;
  readonly projectId: number;
  /** The project folder, where pi runs. */
  readonly project: string;
  readonly title: string;
  /** Whether Tondo is waiting to hear if pi may load the project's own settings and extensions. */
  readonly askingTrust: boolean;
  readonly pi: PiStatus;
}

type Versioned<T> = T & { readonly v: typeof PROTOCOL_VERSION };

/** What the page asks of the host. */
export type ClientMessage = Versioned<
  /** Ask for a folder, add it as a project and start a thread there. */
  | { type: "add-project" }
  /** Forget a project and what Tondo kept about its threads. pi's session files stay. */
  | { type: "remove-project"; projectId: number }
  | { type: "set-collapsed"; projectId: number; collapsed: boolean }
  | { type: "new-thread"; projectId: number }
  /** Put a thread on screen, starting its pi if it isn't running. */
  | { type: "open-thread"; threadId: string }
  | { type: "rename-thread"; threadId: string; name: string }
  | { type: "pin-thread"; threadId: string; pinned: boolean }
  | { type: "archive-thread"; threadId: string; archived: boolean }
  /** What a thread's composer holds, which Tondo keeps across restarts. */
  | { type: "set-draft"; threadId: string; text: string }
  | { type: "set-sidebar-hidden"; hidden: boolean }
  /** Look for sessions pi wrote outside Tondo, such as in its own interface. */
  | { type: "refresh" }
  /** Your answer to whether to trust the thread's project. */
  | { type: "trust"; threadId: string; trusted: boolean }
  /** Send `text` to pi. While pi works it joins the queue the way `streamingBehavior` says. */
  | { type: "prompt"; threadId: string; text: string; streamingBehavior: StreamingBehavior }
  /** Escape: take pi's queue back into the composer, then stop pi. */
  | { type: "stop"; threadId: string }
  /** Alt+Up: take pi's queue back into the composer. */
  | { type: "dequeue"; threadId: string }
  | { type: "set-model"; threadId: string; provider: string; modelId: string }
  | { type: "set-thinking-level"; threadId: string; level: ThinkingLevel }
  /** Start pi again after it exited. */
  | { type: "restart"; threadId: string }
  | { type: "ping"; id: number }
>;

/** What the host sends the page. */
export type HostMessage = Versioned<
  /**
   * The thread on screen, whole, with its draft. The host sends it to each
   * new port, when you open a thread and when its pi starts or exits.
   * `thread` is null while no thread is open.
   */
  | { type: "snapshot"; thread: OpenThread | null; state: ThreadState; draft: string }
  /** Events that came due since the last batch, already applied to the host's copy of the thread. */
  | { type: "events"; threadId: string; events: PiEvent[] }
  /** The title, the trust question or pi's status of the thread on screen changed. */
  | { type: "status"; thread: OpenThread }
  | { type: "sidebar"; projects: SidebarProject[] }
  /** The window's state that outlives a restart. The host sends it to each new port. */
  | { type: "ui"; sidebarHidden: boolean }
  /** Text for the thread's composer: messages taken back from pi's queue, or a prompt pi didn't take. */
  | { type: "restore"; threadId: string; text: string }
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
  /** Tondo's app data folder, which holds settings.json and the store. */
  userData: string;
  /** PI_CODING_AGENT_DIR for every pi. Unpackaged runs set it so they leave ~/.pi/agent alone. */
  piAgentDir?: string;
  /** Arguments added to every pi's command line. Unpackaged runs take them from TONDO_PI_ARGS. */
  piArgs: string[];
  /** Overrides for the limits on running pi processes. Unpackaged runs take them from TONDO_POOL. */
  pool?: { maxLive?: number; idleMs?: number };
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

/** Longer than any session id pi or Tondo makes, and short enough to log. */
const MAX_THREAD_ID = 200;

/**
 * Checks a message from the page and returns a fresh copy of it. Anything
 * that isn't exactly one of the ClientMessage shapes is rejected with a
 * reason, and hostile values never make it throw. The host still checks
 * that a thread, project, model or thinking level exists.
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
  const { type, threadId, projectId } = message;
  switch (type) {
    case "add-project":
      return exactly(message, { v, type });
    case "remove-project":
    case "new-thread": {
      const bad = badProjectId(type, projectId);
      if (bad) return invalid(bad);
      return exactly(message, { v, type, projectId: projectId as number });
    }
    case "set-collapsed": {
      const bad = badProjectId(type, projectId);
      if (bad) return invalid(bad);
      const { collapsed } = message;
      if (typeof collapsed !== "boolean") {
        return invalid(
          `set-collapsed: collapsed must be true or false, not ${describe(collapsed)}`,
        );
      }
      return exactly(message, { v, type, projectId: projectId as number, collapsed });
    }
    case "open-thread":
    case "stop":
    case "dequeue":
    case "restart": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      return exactly(message, { v, type, threadId: threadId as string });
    }
    case "rename-thread": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { name } = message;
      if (typeof name !== "string" || !name.trim()) {
        return invalid(
          `rename-thread: name must be a string that isn't blank, not ${describe(name)}`,
        );
      }
      return exactly(message, { v, type, threadId: threadId as string, name });
    }
    case "pin-thread": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { pinned } = message;
      if (typeof pinned !== "boolean") {
        return invalid(`pin-thread: pinned must be true or false, not ${describe(pinned)}`);
      }
      return exactly(message, { v, type, threadId: threadId as string, pinned });
    }
    case "archive-thread": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { archived } = message;
      if (typeof archived !== "boolean") {
        return invalid(`archive-thread: archived must be true or false, not ${describe(archived)}`);
      }
      return exactly(message, { v, type, threadId: threadId as string, archived });
    }
    case "set-draft": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { text } = message;
      if (typeof text !== "string") {
        return invalid(`set-draft: text must be a string, not ${describe(text)}`);
      }
      return exactly(message, { v, type, threadId: threadId as string, text });
    }
    case "set-sidebar-hidden": {
      const { hidden } = message;
      if (typeof hidden !== "boolean") {
        return invalid(`set-sidebar-hidden: hidden must be true or false, not ${describe(hidden)}`);
      }
      return exactly(message, { v, type, hidden });
    }
    case "refresh":
      return exactly(message, { v, type });
    case "trust": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { trusted } = message;
      if (typeof trusted !== "boolean") {
        return invalid(`trust: trusted must be true or false, not ${describe(trusted)}`);
      }
      return exactly(message, { v, type, threadId: threadId as string, trusted });
    }
    case "prompt": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { text, streamingBehavior } = message;
      if (typeof text !== "string" || !text.trim()) {
        return invalid(`prompt: text must be a string that isn't blank, not ${describe(text)}`);
      }
      if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") {
        return invalid(
          `prompt: streamingBehavior must be "steer" or "followUp", not ${describe(streamingBehavior)}`,
        );
      }
      return exactly(message, {
        v,
        type,
        threadId: threadId as string,
        text,
        streamingBehavior,
      });
    }
    case "set-model": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { provider, modelId } = message;
      if (typeof provider !== "string" || typeof modelId !== "string") {
        return invalid(
          `set-model: provider and modelId must be strings, not ${describe(provider)} and ${describe(modelId)}`,
        );
      }
      return exactly(message, { v, type, threadId: threadId as string, provider, modelId });
    }
    case "set-thinking-level": {
      const bad = badThreadId(type, threadId);
      if (bad) return invalid(bad);
      const { level } = message;
      if (typeof level !== "string") {
        return invalid(`set-thinking-level: level must be a string, not ${describe(level)}`);
      }
      // The host accepts only the levels pi offered for the current model.
      return exactly(message, {
        v,
        type,
        threadId: threadId as string,
        level: level as ThinkingLevel,
      });
    }
    case "ping": {
      const { id } = message;
      if (!Number.isSafeInteger(id)) {
        return invalid(`ping: id must be an integer, not ${describe(id)}`);
      }
      return exactly(message, { v, type, id: id as number });
    }
    default:
      return invalid(`unknown message type ${describe(type)}`);
  }
}

/** Why `threadId` isn't one, or undefined if it is. The host still checks that the thread exists. */
function badThreadId(type: string, threadId: unknown): string | undefined {
  if (typeof threadId === "string" && threadId.length > 0 && threadId.length <= MAX_THREAD_ID) {
    return undefined;
  }
  return `${type}: threadId must be a string of 1 to ${MAX_THREAD_ID} characters, not ${describe(threadId)}`;
}

/** Why `projectId` isn't one, or undefined if it is. The host still checks that the project exists. */
function badProjectId(type: string, projectId: unknown): string | undefined {
  if (Number.isSafeInteger(projectId)) return undefined;
  return `${type}: projectId must be an integer, not ${describe(projectId)}`;
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
