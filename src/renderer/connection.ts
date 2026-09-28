// The page's end of its MessagePort to the host. Main hands the page a port
// on every load and whenever the host restarts. The host answers each port
// with the sidebar and a snapshot of the open thread, and after that sends
// only what changes.
import { create } from "zustand";
import {
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostMessage,
  type OpenThread,
  type PiStatus,
  type SidebarProject,
  type StreamingBehavior,
  type ThinkingLevel,
} from "../shared/protocol";
import { joinDrafts, setDraft, useDraft } from "./composer/draft";
import { keepUnchanged } from "./sidebar/model";
import { receiveEvents, showThread } from "./thread/store";

type Connection = "connecting" | "connected" | "reconnecting";

export const useHost = create<{
  connection: Connection;
  /** The thread on screen, or null if none is. */
  thread: OpenThread | null;
  projects: readonly SidebarProject[];
  sidebarHidden: boolean;
  /** Errors the host reported, oldest first, until you dismiss them. */
  errors: readonly string[];
}>()(() => ({
  connection: "connecting",
  thread: null,
  projects: [],
  sidebarHidden: false,
  errors: [],
}));

const NO_PI: PiStatus = { state: "stopped" };

/** The pi of the thread on screen. */
export function usePi(): PiStatus {
  return useHost((host) => host.thread?.pi ?? NO_PI);
}

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

function shownId(): string | undefined {
  return useHost.getState().thread?.id;
}

function receive(message: HostMessage): void {
  if (message.v !== PROTOCOL_VERSION) {
    fail(`The host speaks protocol version ${message.v}, but the page speaks ${PROTOCOL_VERSION}.`);
    return;
  }
  switch (message.type) {
    case "snapshot": {
      const shown = shownId();
      showThread(message.state);
      useHost.setState({ connection: "connected", thread: message.thread });
      // The composer holds newer text than the host for the thread it already shows.
      if (message.thread?.id !== shown) setDraft(message.draft);
      break;
    }
    case "events":
      if (message.threadId === shownId()) receiveEvents(message.events);
      break;
    case "status":
      if (message.thread.id === shownId()) useHost.setState({ thread: message.thread });
      break;
    case "sidebar":
      useHost.setState(({ projects }) => ({ projects: keepUnchanged(projects, message.projects) }));
      break;
    case "ui":
      useHost.setState({ sidebarHidden: message.sidebarHidden });
      break;
    case "restore":
      if (message.threadId === shownId()) editDraft(joinDrafts(message.text, useDraft.getState()));
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
  saveDraft();
}

/** Waits for the ports main sends. Call it once, before the first render. */
export function connectToHost(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== PORT_MESSAGE) return;
    const [next] = event.ports;
    if (next && event.ports.length === 1) accept(next);
  });
  // pi may have written sessions while you were in another app, such as in its terminal UI.
  window.addEventListener("focus", () => {
    if (port) send({ v, type: "refresh" });
  });
}

/** How long the composer waits after you stop typing to save the draft. */
const DRAFT_SAVE_MS = 250;

/** The draft waiting to be saved, and the thread it belongs to. */
let unsaved: { threadId: string; text: string } | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Changes the composer's text and saves it as the open thread's draft soon after. */
export function editDraft(text: string): void {
  setDraft(text);
  const threadId = shownId();
  if (threadId === undefined) return;
  unsaved = { threadId, text };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, DRAFT_SAVE_MS);
}

function saveDraft(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!unsaved || !port) return;
  const { threadId, text } = unsaved;
  unsaved = undefined;
  port.postMessage({ v, type: "set-draft", threadId, text } satisfies ClientMessage);
}

function send(message: ClientMessage): void {
  if (!port) throw new Error("The page has no port to the host yet");
  // The host sees the draft you wrote before anything you do after it.
  saveDraft();
  port.postMessage(message);
}

/** The thread on screen, for commands that act on it. */
function requireShownId(): string {
  const id = shownId();
  if (id === undefined) throw new Error("No thread is open");
  return id;
}

/** Shows the folder dialog and opens a new thread in the folder you pick. */
export function addProject(): void {
  send({ v, type: "add-project" });
}

export function removeProject(projectId: number): void {
  send({ v, type: "remove-project", projectId });
}

export function setCollapsed(projectId: number, collapsed: boolean): void {
  send({ v, type: "set-collapsed", projectId, collapsed });
}

export function newThread(projectId: number): void {
  send({ v, type: "new-thread", projectId });
}

export function openThread(id: string): void {
  if (id !== shownId()) send({ v, type: "open-thread", threadId: id });
}

export function renameThread(id: string, name: string): void {
  send({ v, type: "rename-thread", threadId: id, name });
}

export function pinThread(id: string, pinned: boolean): void {
  send({ v, type: "pin-thread", threadId: id, pinned });
}

export function archiveThread(id: string, archived: boolean): void {
  send({ v, type: "archive-thread", threadId: id, archived });
}

export function toggleSidebar(): void {
  const hidden = !useHost.getState().sidebarHidden;
  useHost.setState({ sidebarHidden: hidden });
  send({ v, type: "set-sidebar-hidden", hidden });
}

export function answerTrust(trusted: boolean): void {
  send({ v, type: "trust", threadId: requireShownId(), trusted });
}

export function prompt(text: string, streamingBehavior: StreamingBehavior): void {
  send({ v, type: "prompt", threadId: requireShownId(), text, streamingBehavior });
}

export function stop(): void {
  send({ v, type: "stop", threadId: requireShownId() });
}

export function dequeue(): void {
  send({ v, type: "dequeue", threadId: requireShownId() });
}

export function setModel(provider: string, modelId: string): void {
  send({ v, type: "set-model", threadId: requireShownId(), provider, modelId });
}

export function setThinkingLevel(level: ThinkingLevel): void {
  send({ v, type: "set-thinking-level", threadId: requireShownId(), level });
}

export function restartPi(): void {
  send({ v, type: "restart", threadId: requireShownId() });
}
