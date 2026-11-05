import type { ClientMessage, HostMessage } from "./protocol";

export const REMOTE_PORT = 43187;
export const REMOTE_FRAME_BYTES = 8 * 1024 * 1024;
export const REMOTE_REQUEST_BYTES = 64 * 1024;
export const REMOTE_MAX_CLIENTS = 4;
export const REMOTE_RECENT_MESSAGES = 64;

/** Pairing information goes only to the local Electron page, never to a remote peer. */
export type RemoteStatus =
  | { state: "off" | "starting" }
  | { state: "ready"; code: string; port: number }
  | { state: "error"; message: string };

export type RemoteToHost =
  | { type: "connect"; clientId: string }
  | { type: "disconnect"; clientId: string }
  | { type: "request"; clientId: string; id: string; message: ClientMessage }
  | { type: "delivered"; clientId: string };

export type HostToRemote =
  | { type: "message"; clientId: string; message: HostMessage }
  | { type: "close"; clientId: string; reason: string };

const REMOTE_REQUESTS = new Set<ClientMessage["type"]>([
  "open-thread",
  "new-thread",
  "prompt",
  "stop",
  "set-model",
  "set-thinking-level",
  "answer",
  "history-index",
  "history-preview",
  "history-page",
  "list-checkpoints",
  "read-checkpoint",
  "ping",
]);

/** Network clients get a deliberately smaller capability set than the desktop. */
export function remoteRequestAllowed(message: ClientMessage): boolean {
  if (!REMOTE_REQUESTS.has(message.type)) return false;
  return message.type !== "prompt" || (message.imageIds?.length ?? 0) === 0;
}
