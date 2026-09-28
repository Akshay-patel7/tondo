// The page's end of its MessagePort to the host. Main hands the page a port
// on every load and whenever the host restarts. The host answers each port
// with a snapshot of the workspace and its thread, and after that sends only
// what changes.
import { create } from "zustand";
import {
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostMessage,
  type StreamingBehavior,
  type ThinkingLevel,
  type Workspace,
} from "../shared/protocol";
import { restoreToDraft } from "./composer/draft";
import { openThread, receiveEvents } from "./thread/store";

type Connection = "connecting" | "connected" | "reconnecting";

export const useHost = create<{
  connection: Connection;
  workspace: Workspace;
  /** Errors the host reported, oldest first, until you dismiss them. */
  errors: readonly string[];
}>()(() => ({
  connection: "connecting",
  workspace: { project: null, askingTrust: false, pi: { state: "stopped" } },
  errors: [],
}));

const v = PROTOCOL_VERSION;
let port: MessagePort | undefined;

function fail(message: string): void {
  console.error(`Tondo Host: ${message}`);
  useHost.setState(({ errors }) =>
    errors.includes(message) ? {} : { errors: [...errors, message] },
  );
}

export function dismissError(message: string): void {
  useHost.setState(({ errors }) => ({ errors: errors.filter((error) => error !== message) }));
}

function receive(message: HostMessage): void {
  if (message.v !== PROTOCOL_VERSION) {
    fail(`The host speaks protocol version ${message.v}, but the page speaks ${PROTOCOL_VERSION}.`);
    return;
  }
  switch (message.type) {
    case "snapshot":
      openThread(message.thread);
      useHost.setState({ connection: "connected", workspace: message.workspace });
      break;
    case "events":
      receiveEvents(message.events);
      break;
    case "workspace":
      useHost.setState({ workspace: message.workspace });
      break;
    case "restore":
      restoreToDraft(message.text);
      break;
    case "pong":
      break;
    case "error":
      fail(message.message);
      break;
  }
}

function accept(next: MessagePort): void {
  port?.close();
  port = next;
  next.addEventListener("message", (event: MessageEvent<HostMessage>) => receive(event.data));
  // Electron closes the port when the host dies. Main restarts it and sends a new port.
  next.addEventListener("close", () => {
    if (port === next) useHost.setState({ connection: "reconnecting" });
  });
  next.start();
}

/** Waits for the ports main sends. Call it once, before the first render. */
export function connectToHost(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== PORT_MESSAGE) return;
    const [next] = event.ports;
    if (next && event.ports.length === 1) accept(next);
  });
}

function send(message: ClientMessage): void {
  if (!port) throw new Error("The page has no port to the host yet");
  port.postMessage(message);
}

/** Shows the folder dialog and opens a thread in the folder you pick. */
export function openProject(): void {
  send({ v, type: "open-project" });
}

export function answerTrust(trusted: boolean): void {
  send({ v, type: "trust", trusted });
}

export function prompt(text: string, streamingBehavior: StreamingBehavior): void {
  send({ v, type: "prompt", text, streamingBehavior });
}

export function stop(): void {
  send({ v, type: "stop" });
}

export function dequeue(): void {
  send({ v, type: "dequeue" });
}

export function setModel(provider: string, modelId: string): void {
  send({ v, type: "set-model", provider, modelId });
}

export function setThinkingLevel(level: ThinkingLevel): void {
  send({ v, type: "set-thinking-level", level });
}

export function restartPi(): void {
  send({ v, type: "restart" });
}
