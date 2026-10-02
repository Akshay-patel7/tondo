// The page's end of its MessagePort to the host. Main hands the page a port
// on every load and whenever the host restarts. The host answers each port
// with the sidebar and a snapshot of the open thread, and after that sends
// only what changes.
import { create } from "zustand";
import type { FileIndex } from "../shared/files";
import type { CheckpointDiff, CheckpointTurn } from "../shared/checkpoints";
import {
  IMAGE_COUNT,
  IMAGE_TOTAL_BYTES,
  imageBytes,
  imagesError,
  type DraftImage,
} from "../shared/images";
import { readImages } from "./composer/images";
import {
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DialogAnswer,
  type HostMessage,
  type OpenThread,
  type PiStatus,
  type SidebarProject,
  type StreamingBehavior,
  type ThinkingLevel,
} from "../shared/protocol";
import { joinDrafts, setDraft, useDraft, useDraftImages } from "./composer/draft";
import { showExtensionUi } from "./extensionUi/store";
import { closeSheet, openSheet } from "./sheets/store";
import { keepUnchanged } from "./sidebar/model";
import { receiveEvents, showThread } from "./thread/store";
import { addToast } from "./toasts/store";

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

export const useFiles = create<{ id: number; index: FileIndex | null }>()(() => ({
  id: 0,
  index: null,
}));

export const useCheckpoints = create<{
  turns: readonly CheckpointTurn[];
  shared: boolean;
  unavailable: string | null;
  id: number;
  turn: number | null;
  diff: CheckpointDiff | null;
}>()(() => ({ turns: [], shared: false, unavailable: null, id: 0, turn: null, diff: null }));

/** Per-thread so switching away during pi's acknowledgement doesn't unlock that draft. */
export const useImageSends = create<ReadonlySet<string>>(() => new Set());

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

export function listCheckpoints(): void {
  send({ v, type: "list-checkpoints", threadId: requireShownId() });
}

export function readCheckpoint(turn: number): void {
  const id = useCheckpoints.getState().id + 1;
  useCheckpoints.setState({ id, turn, diff: null });
  send({ v, type: "read-checkpoint", threadId: requireShownId(), turn, id });
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
      showExtensionUi(message.ui);
      useHost.setState({ connection: "connected", thread: message.thread });
      // The composer holds newer text than the host for the thread it already shows.
      if (message.thread?.id !== shown) {
        setDraft(message.draft);
        useDraftImages.setState(message.images, true);
        closeSheet();
        useCheckpoints.setState(({ id }) => ({
          turns: [],
          shared: false,
          unavailable: null,
          turn: null,
          diff: null,
          id: id + 1,
        }));
      }
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
    case "files":
      if (message.threadId === shownId() && message.id === useFiles.getState().id) {
        useFiles.setState({ index: message.index });
      }
      break;
    case "checkpoints":
      if (message.threadId === shownId())
        useCheckpoints.setState({
          turns: message.turns,
          shared: message.shared,
          unavailable: message.unavailable,
        });
      break;
    case "checkpoint-diff":
      if (message.threadId === shownId() && message.id === useCheckpoints.getState().id)
        useCheckpoints.setState({ turn: message.turn, diff: message.diff });
      break;
    case "image-send-ended": {
      const sending = new Set(useImageSends.getState());
      sending.delete(message.threadId);
      useImageSends.setState(sending, true);
      if (message.sent && message.threadId === shownId()) {
        useDraftImages.setState(
          useDraftImages.getState().filter((image) => !message.imageIds.includes(image.id)),
          true,
        );
      }
      break;
    }
    case "ui":
      useHost.setState({ sidebarHidden: message.sidebarHidden });
      break;
    case "restore":
      if (message.threadId === shownId()) editDraft(joinDrafts(message.text, useDraft.getState()));
      break;
    case "extension-ui":
      if (message.threadId === shownId()) showExtensionUi(message.ui);
      break;
    case "editor-text":
      if (message.threadId === shownId()) editDraft(message.text);
      break;
    case "toast": {
      const { level, message: text, thread, reveal } = message;
      addToast({
        level,
        message: text,
        ...(thread === undefined ? {} : { thread }),
        ...(reveal === undefined ? {} : { reveal }),
      });
      break;
    }
    case "sheet":
      if (message.threadId === shownId()) openSheet(message.sheet);
      break;
    case "pong":
      break;
    case "error":
      fail(message.message);
      break;
  }
}

function accept(next: MessagePort): void {
  useCheckpoints.setState(({ id }) => ({
    turns: [],
    shared: false,
    unavailable: null,
    turn: null,
    diff: null,
    id: id + 1,
  }));
  useImageSends.setState(new Set(), true);
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

/** Starts a scan for a newly opened file menu. Filtering the returned index happens in the page. */
export function listFiles(): void {
  const id = useFiles.getState().id + 1;
  useFiles.setState({ id, index: null });
  send({ v, type: "list-files", threadId: requireShownId(), id });
}

/** Attach to the thread that began the read, never to one opened while decoding. */
export async function attachImages(
  threadId: string | undefined,
  files: readonly File[],
): Promise<void> {
  if (threadId === undefined || useImageSends.getState().has(threadId))
    throw new Error("Wait for pi to accept these images before changing attachments.");
  const attached = useDraftImages.getState();
  if (files.length + attached.length > IMAGE_COUNT)
    throw new Error(`Attach at most ${IMAGE_COUNT} images.`);
  if (
    files.reduce((sum, file) => sum + file.size, 0) +
      attached.reduce((sum, image) => sum + imageBytes(image.data), 0) >
    IMAGE_TOTAL_BYTES
  )
    throw new Error("Images must total 10 MiB or less.");
  const added = await readImages(files);
  if (shownId() !== threadId)
    throw new Error(
      "Images weren't attached because you switched threads. Paste or drop them again.",
    );
  if (useImageSends.getState().has(threadId))
    throw new Error("Wait for pi to accept these images before changing attachments.");
  const next = [...useDraftImages.getState(), ...added];
  const error = imagesError(next);
  if (error) throw new Error(error);
  editImages(next);
}

export function editImages(images: readonly DraftImage[]): void {
  useDraftImages.setState(images, true);
  send({ v, type: "set-draft-images", threadId: requireShownId(), images });
}

export function prompt(
  text: string,
  streamingBehavior: StreamingBehavior,
  images: readonly DraftImage[] = [],
): void {
  const threadId = requireShownId();
  if (images.length > 0)
    useImageSends.setState(new Set([...useImageSends.getState(), threadId]), true);
  send({
    v,
    type: "prompt",
    threadId,
    text,
    streamingBehavior,
    ...(images.length > 0 ? { imageIds: images.map((image) => image.id) } : {}),
  });
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

/** Answers an extension's dialog in the thread on screen. */
export function answerDialog(dialogId: string, answer: DialogAnswer): void {
  send({ v, type: "answer", threadId: requireShownId(), dialogId, answer });
}

export function compactContext(instructions: string): void {
  send({ v, type: "compact", threadId: requireShownId(), instructions });
}

export function copyLastReply(): void {
  send({ v, type: "copy-reply", threadId: requireShownId() });
}

export function exportThread(path: string): void {
  send({ v, type: "export", threadId: requireShownId(), path });
}

export function showSessionInfo(): void {
  send({ v, type: "session-info", threadId: requireShownId() });
}

export function showSettingsFiles(): void {
  send({ v, type: "settings-files", threadId: requireShownId() });
}

export function showTrust(): void {
  send({ v, type: "trust-status", threadId: requireShownId() });
}

export function reloadPi(): void {
  send({ v, type: "reload", threadId: requireShownId() });
}

/** Shows a file the host offered in Finder. */
export function revealFile(path: string): void {
  send({ v, type: "reveal", path });
}
