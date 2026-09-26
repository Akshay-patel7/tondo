// The messages that cross between the page, the host and main. The page and
// the host talk over a MessagePort that main hands them on each page load.
// The page renders content from pi and the web, so the host checks every
// message the page sends with parseClientMessage before acting on it.
import type { PiEvent, ThreadState } from "./thread";

/** Bump it when a message between the page and the host changes shape. */
export const PROTOCOL_VERSION = 1;

/** Main sends the preload the page's port on this channel, and the preload passes it on as this message. */
export const PORT_MESSAGE = "tondo:port";

/** The recorded pi output in fixtures/ that the host can replay. */
export const FIXTURES = ["stream-1000", "stream-200", "tools", "error", "abort"] as const;
export type FixtureName = (typeof FIXTURES)[number];

export type PlayerStatus = "idle" | "playing";

type Versioned<T> = T & { readonly v: typeof PROTOCOL_VERSION };

/** What the page asks of the host. */
export type ClientMessage = Versioned<
  /** `speed` multiplies the recorded pace: 1 replays in real time. */
  | { type: "play"; fixture: FixtureName; speed: number }
  | { type: "stop" }
  /** Send the whole thread again. It stands in for switching to it until Stage 5. */
  | { type: "reopen" }
  | { type: "ping"; id: number }
>;

/** What the host sends the page. */
export type HostMessage = Versioned<
  /** The whole thread. The host sends it once per port, and again on reopen. */
  | { type: "snapshot"; thread: ThreadState; status: PlayerStatus }
  /** Events that came due since the last batch, already applied to the host's thread. */
  | { type: "events"; events: PiEvent[] }
  | { type: "player"; status: PlayerStatus }
  | { type: "pong"; id: number }
  | { type: "error"; message: string }
>;

/**
 * What main sends the host. `connect` carries the host's end of a new page
 * port. Main and the host come from the same build, so these aren't versioned.
 */
export type MainToHostMessage = { type: "connect" } | { type: "collect-garbage" };

/** What the host sends main. */
export type HostToMainMessage =
  /** The host is listening and has opened its thread, so main can connect a page. */
  | { type: "ready" }
  /** Every process group the host started. Main kills them if the host dies. */
  | { type: "process-groups"; pgids: number[] }
  | { type: "garbage-collected" };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

/**
 * Checks a message from the page and returns a fresh copy of it. Anything
 * that isn't exactly one of the ClientMessage shapes is rejected with a
 * reason, and hostile values never make it throw.
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
    case "play": {
      const { fixture, speed } = message;
      if (!FIXTURES.includes(fixture as FixtureName)) {
        return invalid(`play: unknown fixture ${describe(fixture)}`);
      }
      if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) {
        return invalid(`play: speed must be a positive number, not ${describe(speed)}`);
      }
      return exactly(message, { v, type: "play", fixture: fixture as FixtureName, speed });
    }
    case "stop":
      return exactly(message, { v, type: "stop" });
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
