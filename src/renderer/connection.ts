// The page's end of its MessagePort to the host. Main hands the page a port
// on every load and whenever the host restarts. The host answers each port
// with a snapshot of the thread, and after that sends only batches of events.
import { create } from "zustand";
import {
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type FixtureName,
  type HostMessage,
  type PlayerStatus,
} from "../shared/protocol";
import { openThread, receiveEvents } from "./thread/store";

type Connection = "connecting" | "connected" | "reconnecting";

export const useHost = create<{
  connection: Connection;
  /** The fixture player's status, as of the host's last message. */
  status: PlayerStatus;
  error: string | null;
}>()(() => ({ connection: "connecting", status: "idle", error: null }));

const v = PROTOCOL_VERSION;
let port: MessagePort | undefined;

function fail(message: string): void {
  console.error(`Tondo Host: ${message}`);
  useHost.setState({ error: message });
}

function receive(message: HostMessage): void {
  if (message.v !== PROTOCOL_VERSION) {
    fail(`sent protocol version ${message.v}, but the page speaks ${PROTOCOL_VERSION}`);
    return;
  }
  switch (message.type) {
    case "snapshot":
      openThread(message.thread);
      useHost.setState({ connection: "connected", status: message.status });
      break;
    case "events":
      receiveEvents(message.events);
      break;
    case "player":
      useHost.setState({ status: message.status });
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

export function play(fixture: FixtureName, speed: number): void {
  useHost.setState({ error: null });
  send({ v, type: "play", fixture, speed });
}

export function stop(): void {
  send({ v, type: "stop" });
}

/** Stands in for switching back to this thread: the timeline mounts from a fresh copy. */
export function reopen(): void {
  send({ v, type: "reopen" });
}
