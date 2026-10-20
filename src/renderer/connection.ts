// The page's end of its MessagePort to the host. Main hands the page a port
// on every load and whenever the host restarts. The host answers each port
// with the sidebar and a snapshot of the open thread, and after that sends
// only what changes.
import { create } from "zustand";
import type { FileIndex } from "../shared/files";
import type { PickedFiles } from "../shared/attachments";
import type { AgentCheckout, GitAction, GitStatus } from "../shared/git";
import { NO_PI_UPDATES, type PiUpdates } from "../shared/piUpdates";
import type { CheckpointDiff, CheckpointTurn } from "../shared/checkpoints";
import {
  IMAGE_COUNT,
  IMAGE_TOTAL_BYTES,
  imageBytes,
  imagesError,
  type DraftImage,
} from "../shared/images";
import { readImages, validatePickedImages } from "./composer/images";
import {
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DialogAnswer,
  type HostMessage,
  type OpenThread,
  type PiAccount,
  type PiDiscovery,
  type PiStatus,
  type SettingsFile,
  type SidebarProject,
  type SidebarThread,
  type StreamingBehavior,
  type ThinkingLevel,
} from "../shared/protocol";
import { editorText, joinDrafts, setDraft, useDraft, useDraftImages } from "./composer/draft";
import { showExtensionUi } from "./extensionUi/store";
import { closeSheet, openSheet } from "./sheets/store";
import { keepUnchanged } from "./sidebar/model";
import { receiveEvents, showThread } from "./thread/store";
import { addToast } from "./toasts/store";
import type { AppSettings, SettingsPatch } from "../shared/settings";
import type { TerminalCommand, TerminalKind } from "../shared/terminal";
import { receiveTerminal, resetTerminals, useTerminals } from "./terminal/store";

type Connection = "connecting" | "connected" | "reconnecting";

export const useHost = create<{
  connection: Connection;
  /** The thread on screen, or null if none is. */
  thread: OpenThread | null;
  projects: readonly SidebarProject[];
  sidebarHidden: boolean;
  /** Shared by the palette and sidebar; neither sends deletion before confirmation. */
  deletion: SidebarThread | null;
  confirmingDeletion: boolean;
  /** Errors the host reported, oldest first, until you dismiss them. */
  errors: readonly string[];
  /** Tondo's settings, or null until the host sends them. */
  settings: AppSettings | null;
  /** Why the host refused the last settings change, or null if it took it. */
  settingsError: string | null;
  /** Why Tondo can't use settings.json, or null if it can. */
  settingsFileError: string | null;
  /** settings.json, which the page may show in Finder while settingsFileError is set. */
  settingsFilePath: string | null;
  /** Why the host couldn't keep your answer to a thread's trust question, and a file to show. */
  trustError: {
    readonly threadId: string;
    readonly message: string;
    readonly reveal?: string;
  } | null;
  /** The pi Tondo would run, or null until the host has looked. */
  piEnv: PiDiscovery | null;
  /** pi's config files, or null until requestPiConfigFiles is answered. */
  piConfigFiles: readonly SettingsFile[] | null;
  /** The sign-ins in pi's auth.json, or null until requestPiAccounts is answered. */
  piAccounts: {
    readonly accounts: readonly PiAccount[];
    /** Why the host couldn't read them. */
    readonly error: string | null;
  } | null;
}>()(() => ({
  connection: "connecting",
  thread: null,
  projects: [],
  sidebarHidden: false,
  deletion: null,
  confirmingDeletion: false,
  errors: [],
  settings: null,
  settingsError: null,
  settingsFileError: null,
  settingsFilePath: null,
  trustError: null,
  piEnv: null,
  piConfigFiles: null,
  piAccounts: null,
}));

export const useFiles = create<{
  id: number;
  index: FileIndex | null;
  /** The host's search of every file, for an index that was truncated. */
  found: { readonly query: string; readonly paths: readonly string[] } | null;
}>()(() => ({
  id: 0,
  index: null,
  found: null,
}));

export const useCheckpoints = create<{
  turns: readonly CheckpointTurn[];
  shared: boolean;
  unavailable: string | null;
  id: number;
  turn: number | null;
  diff: CheckpointDiff | null;
}>()(() => ({ turns: [], shared: false, unavailable: null, id: 0, turn: null, diff: null }));

export const useGit = create<{
  status: GitStatus | null;
  error: string | null;
  busy: boolean;
  agentCheckout: AgentCheckout | null;
}>()(() => ({ status: null, error: null, busy: false, agentCheckout: null }));
export const usePiUpdates = create<PiUpdates>()(() => NO_PI_UPDATES);

export function checkPiUpdates(manual = true): void {
  send({ v, type: "check-pi-updates", manual });
}

export function applyPiUpdate(id: string): void {
  send({ v, type: "apply-pi-update", id });
}

let gitRequest = 0;
const gitRequests = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

export function refreshGit(): void {
  send({ v, type: "git-refresh", threadId: requireShownId() });
}

export function performGit(action: GitAction, expectedBranch: string | null): Promise<void> {
  if (useHost.getState().connection !== "connected")
    return Promise.reject(
      new Error("The host is reconnecting. Review Git state after it returns."),
    );
  const id = ++gitRequest;
  useGit.setState({ busy: true });
  return new Promise((resolve, reject) => {
    gitRequests.set(id, { resolve, reject });
    try {
      send({ v, type: "git-action", threadId: requireShownId(), id, expectedBranch, action });
    } catch (error) {
      gitRequests.delete(id);
      useGit.setState({ busy: gitRequests.size > 0 });
      reject(error);
    }
  });
}

function disconnectGit(): void {
  for (const pending of gitRequests.values())
    pending.reject(
      new Error(
        "The host disconnected. Review Git state before retrying; the action may have completed.",
      ),
    );
  gitRequests.clear();
  useGit.setState({ status: null, error: null, busy: false, agentCheckout: null });
}

/** Each project folder's checkout as the host last read it, for the home page. */
export const useProjectGit = create<
  ReadonlyMap<number, { readonly git: boolean; readonly branch: string | null }>
>()(() => new Map());

/** Asks the host whether a project folder is a Git checkout, and on which branch. */
export function requestProjectGit(projectId: number): void {
  send({ v, type: "get-project-git", projectId });
}

/** What the home page sends to start a thread. */
export interface FirstSend {
  readonly projectId: number;
  /** Start in a new managed worktree from `base`, the project's branch (null: its detached HEAD). */
  readonly worktree: { readonly base: string | null } | null;
  readonly text: string;
  readonly images: readonly DraftImage[];
}

/**
 * The home page's send, from asking for its thread until pi takes it:
 * "thread" waits for the new thread, "worktree" for the worktree thread made
 * from it, and "pi" for that thread's pi to be ready.
 */
let firstSend:
  | (FirstSend & { readonly stage: "thread" | "worktree" })
  | (FirstSend & { readonly stage: "pi"; readonly threadId: string })
  | undefined;

/**
 * Starts a thread in the project, in its local checkout or a new worktree,
 * and sends it `text` and `images` once its pi is ready. Until then they wait
 * in the thread's composer, so nothing is lost if pi can't start.
 */
export function startThread(request: FirstSend): void {
  send({ v, type: "new-thread", projectId: request.projectId });
  firstSend = { ...request, stage: "thread" };
}

/** A branch for a worktree thread: a few words of its prompt, and a suffix that keeps it new. */
function worktreeBranch(text: string): string {
  const words =
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.slice(0, 5) ?? [];
  const suffix = crypto.randomUUID().slice(0, 6);
  return `tondo/${[...words, suffix].join("-")}`;
}

/** Moves the home page's send along after the thread on screen changed. */
function continueFirstSend(): void {
  const pending = firstSend;
  const thread = useHost.getState().thread;
  if (pending === undefined || thread === null) return;
  switch (pending.stage) {
    case "thread":
      if (thread.projectId !== pending.projectId) return;
      if (pending.worktree === null) {
        holdFirstSend(pending, thread.id);
        return;
      }
      // The host changes no checkout while a pi in it is starting.
      if (thread.pi.state === "starting") return;
      firstSend = { ...pending, stage: "worktree" };
      // The host opens the worktree thread, then forgets the unused local one.
      performGit(
        {
          kind: "new-worktree",
          branch: worktreeBranch(pending.text),
          base: pending.worktree.base ?? "HEAD",
        },
        pending.worktree.base,
      ).then(
        () => {
          const shown = useHost.getState().thread;
          if (firstSend?.stage === "worktree" && shown?.worktree) holdFirstSend(pending, shown.id);
        },
        (error: unknown) => {
          // Keep the draft, but never run a worktree request in the local checkout.
          if (firstSend?.stage === "worktree" && shownId() === thread.id) {
            firstSend = undefined;
            editDraft(pending.text);
            if (pending.images.length > 0) editImages(pending.images);
          }
          fail(
            `Couldn't create the worktree: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
      return;
    case "worktree":
      return;
    case "pi":
      if (thread.id !== pending.threadId) {
        // You opened another thread. The text stays in this one's draft.
        firstSend = undefined;
        return;
      }
      switch (thread.pi.state) {
        case "stopped":
        case "starting":
          return;
        case "exited":
          firstSend = undefined;
          return;
        case "ready": {
          firstSend = undefined;
          // Send what the composer holds now, in case you edited it while pi started.
          const text = useDraft.getState().trim();
          const images = useDraftImages.getState();
          if (text === "" && images.length === 0) return;
          editDraft("");
          prompt(text, "steer", images);
          return;
        }
      }
  }
}

/** Puts the send in the new thread's composer, where it waits for pi. */
function holdFirstSend(pending: FirstSend, threadId: string): void {
  firstSend = { ...pending, stage: "pi", threadId };
  editDraft(pending.text);
  if (pending.images.length > 0) editImages(pending.images);
  continueFirstSend();
}

/** Per-thread so switching away during pi's acknowledgement doesn't unlock that draft. */
export const useImageSends = create<ReadonlySet<string>>(() => new Set());

const NO_PI: PiStatus = { state: "stopped" };

/** The pi of the thread on screen. */
export function usePi(): PiStatus {
  return useHost((host) => host.thread?.pi ?? NO_PI);
}

const v = PROTOCOL_VERSION;
let port: MessagePort | undefined;
const filePickers = new Map<
  string,
  {
    resolve: (picked: PickedFiles) => void;
    reject: (error: Error) => void;
  }
>();

function disconnectFilePickers(): void {
  for (const pending of filePickers.values())
    pending.reject(new Error("The host disconnected. Choose the files again."));
  filePickers.clear();
}

/** Only a native, user-confirmed selection supplies paths. Non-images are never copied. */
export async function chooseLocalFiles(): Promise<PickedFiles> {
  const id = crypto.randomUUID();
  const picked = await new Promise<PickedFiles>((resolve, reject) => {
    filePickers.set(id, { resolve, reject });
    try {
      send({ v, type: "choose-files", id });
    } catch (error) {
      filePickers.delete(id);
      reject(error);
    }
  });
  await validatePickedImages(picked.images);
  return picked;
}

/** The thread whose trust answer the host hasn't taken yet. */
let answeringTrust: string | undefined;

/** The composer text an extension last set in the thread on screen. */
let extensionText: string | undefined;

/**
 * Shows an error on the trust question if it's about the answer you just gave.
 * The question covers the banners, and an error left in a banner or a toast
 * would outlive the answer that later succeeds.
 */
function failTrustAnswer(message: string, reveal?: string): boolean {
  const thread = useHost.getState().thread;
  const answering = answeringTrust;
  answeringTrust = undefined;
  if (answering === undefined || thread?.id !== answering || !thread.askingTrust) return false;
  useHost.setState({
    trustError: { threadId: thread.id, message, ...(reveal === undefined ? {} : { reveal }) },
  });
  return true;
}

function fail(message: string): void {
  console.error(`Tondo Host: ${message}`);
  if (failTrustAnswer(message)) return;
  useHost.setState(({ errors }) =>
    errors.includes(message) ? {} : { errors: [...errors, message] },
  );
}

export function terminalCommand(message: TerminalCommand): void {
  send({ v, ...message });
}

/** A new sign-in terminal given `provider` opens pi's sign-in for that provider. */
export function openTerminal(kind: TerminalKind = "shell", provider?: string): void {
  const thread = useHost.getState().thread;
  if (!thread || thread.askingTrust) return;
  const existing = useTerminals.getState().get(thread.id);
  // The host replaces an exited terminal, whatever its kind.
  if (existing?.status === "exited") {
    send({
      v,
      type: "terminal-open",
      threadId: thread.id,
      kind,
      ...(provider === undefined ? {} : { provider }),
    });
    return;
  }
  if (existing && existing.kind !== kind) {
    addToast({
      level: "info",
      message: "Close this thread's terminal before opening a different one.",
    });
    return;
  }
  if (existing) {
    document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
    return;
  }
  send({
    v,
    type: "terminal-open",
    threadId: thread.id,
    kind,
    ...(provider === undefined ? {} : { provider }),
  });
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
    case "files-chosen": {
      const pending = filePickers.get(message.id);
      filePickers.delete(message.id);
      if (message.error !== null) pending?.reject(new Error(message.error));
      else pending?.resolve({ paths: message.paths, images: message.images });
      break;
    }
    case "pi-updates":
      usePiUpdates.setState(message.updates, true);
      break;
    case "git-status":
      if (message.threadId === shownId())
        useGit.setState({
          status: message.status,
          error: message.error,
          agentCheckout: message.agentCheckout,
        });
      break;
    case "git-result": {
      const pending = gitRequests.get(message.id);
      gitRequests.delete(message.id);
      useGit.setState({ busy: gitRequests.size > 0 });
      if (message.error) pending?.reject(new Error(message.error));
      else pending?.resolve();
      break;
    }
    case "terminal-state":
    case "terminal-output":
      receiveTerminal(message);
      break;
    case "snapshot": {
      const shown = shownId();
      showThread(message.state);
      showExtensionUi(message.ui);
      useHost.setState({ connection: "connected", thread: message.thread });
      // The composer holds newer text than the host for the thread it already shows.
      if (message.thread?.id !== shown) {
        extensionText = undefined;
        useGit.setState({ status: null, error: null, agentCheckout: null });
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
      continueFirstSend();
      break;
    }
    case "events":
      if (message.threadId === shownId()) receiveEvents(message.events);
      break;
    case "status":
      if (message.thread.id === shownId()) {
        useHost.setState({ thread: message.thread });
        continueFirstSend();
      }
      break;
    case "sidebar":
      useHost.setState(({ projects }) => ({ projects: keepUnchanged(projects, message.projects) }));
      break;
    case "files":
      if (message.threadId === shownId() && message.id === useFiles.getState().id) {
        useFiles.setState({ index: message.index });
      }
      break;
    case "file-matches":
      if (message.threadId === shownId() && message.id === useFiles.getState().id) {
        useFiles.setState({ found: { query: message.query, paths: message.paths } });
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
      if (message.threadId === shownId()) {
        const text = editorText(useDraft.getState(), message.text, extensionText);
        extensionText = message.text;
        editDraft(text, false);
      }
      break;
    case "toast": {
      const { level, message: text, thread, reveal } = message;
      if (level === "error" && failTrustAnswer(text, reveal)) break;
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
    case "settings":
      useHost.setState({
        settings: message.settings,
        // A change refused because the file is broken shows as the file's problem.
        settingsError: message.error === message.fileProblem?.message ? null : message.error,
        settingsFileError: message.fileProblem?.message ?? null,
        settingsFilePath: message.fileProblem?.path ?? null,
      });
      break;
    case "pi-env":
      useHost.setState({ piEnv: message.pi });
      break;
    case "pi-config-files":
      useHost.setState({ piConfigFiles: message.files });
      break;
    case "pi-accounts":
      useHost.setState({ piAccounts: { accounts: message.accounts, error: message.error } });
      break;
    case "project-git": {
      const { projectId, git, branch } = message;
      useProjectGit.setState(
        new Map(useProjectGit.getState()).set(projectId, { git, branch }),
        true,
      );
      break;
    }
    case "pong":
      break;
    case "error":
      fail(message.message);
      break;
  }
}

function accept(next: MessagePort): void {
  disconnectFilePickers();
  answeringTrust = undefined;
  // A new host may not have made the thread; what you wrote stays in its draft if it did.
  firstSend = undefined;
  resetTerminals();
  useCheckpoints.setState(({ id }) => ({
    turns: [],
    shared: false,
    unavailable: null,
    turn: null,
    diff: null,
    id: id + 1,
  }));
  useImageSends.setState(new Set(), true);
  disconnectGit();
  port?.close();
  port = next;
  next.addEventListener("message", (event: MessageEvent<HostMessage>) => receive(event.data));
  // Electron closes the port when the host dies. Main restarts it and sends a new port.
  next.addEventListener("close", () => {
    if (port === next) {
      useHost.setState({ connection: "reconnecting" });
      disconnectGit();
      disconnectFilePickers();
    }
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
  // Closing the window, quitting or reloading would otherwise drop text typed in the last moments.
  window.addEventListener("pagehide", saveDraft);
}

/** How long the composer waits after you stop typing to save the draft. */
const DRAFT_SAVE_MS = 250;

/** The draft waiting to be saved, and the thread it belongs to. */
let unsaved: { threadId: string; text: string; userInput: boolean } | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Changes the composer's text and saves it as the open thread's draft soon after. */
export function editDraft(text: string, userInput = true): void {
  setDraft(text);
  const threadId = shownId();
  if (threadId === undefined) return;
  // Preserve a pending user edit if an extension updates the composer before its save.
  userInput ||= unsaved?.threadId === threadId && unsaved.userInput && unsaved.text.trim() !== "";
  unsaved = { threadId, text, userInput };
  clearTimeout(saveTimer);
  if (
    userInput &&
    text.trim() !== "" &&
    !useHost
      .getState()
      .projects.some((project) => project.threads.some((thread) => thread.id === threadId))
  ) {
    saveDraft();
    return;
  }
  saveTimer = setTimeout(saveDraft, DRAFT_SAVE_MS);
}

function saveDraft(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!unsaved || !port) return;
  const { threadId, text, userInput } = unsaved;
  unsaved = undefined;
  port.postMessage({ v, type: "set-draft", threadId, text, userInput } satisfies ClientMessage);
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
  send({ v, type: "open-thread", threadId: id });
}

export function renameThread(id: string, name: string): void {
  send({ v, type: "rename-thread", threadId: id, name });
}

export function pinThread(id: string, pinned: boolean): void {
  send({ v, type: "pin-thread", threadId: id, pinned });
}

export function markThreadUnread(id: string): void {
  send({ v, type: "mark-unread", threadId: id });
}

export function deleteThread(id: string): void {
  send({ v, type: "delete-thread", threadId: id });
}

export function toggleSidebar(): void {
  const hidden = !useHost.getState().sidebarHidden;
  useHost.setState({ sidebarHidden: hidden });
  send({ v, type: "set-sidebar-hidden", hidden });
}

export function answerTrust(trusted: boolean): void {
  const threadId = requireShownId();
  answeringTrust = threadId;
  useHost.setState({ trustError: null });
  send({ v, type: "trust", threadId, trusted });
}

/** Starts a scan for a newly opened file menu. Filtering the returned index happens in the page. */
export function listFiles(): void {
  const id = useFiles.getState().id + 1;
  useFiles.setState({ id, index: null, found: null });
  send({ v, type: "list-files", threadId: requireShownId(), id });
}

/** Asks the host to search every project file for `query`, when the menu's index is truncated. */
export function findFiles(query: string): void {
  send({ v, type: "find-files", threadId: requireShownId(), id: useFiles.getState().id, query });
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
  appendImages(threadId, added);
}

/** Merge against the current draft after decoding, never an earlier snapshot. */
export function appendImages(threadId: string | undefined, added: readonly DraftImage[]): void {
  if (shownId() !== threadId)
    throw new Error("Files weren't attached because you switched threads. Choose them again.");
  if (threadId === undefined || useImageSends.getState().has(threadId))
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

export function showTrust(): void {
  send({ v, type: "trust-status", threadId: requireShownId() });
}

export function reloadPi(): void {
  send({ v, type: "reload", threadId: requireShownId() });
}

/** Asks the host to change Tondo's settings. It answers with the settings it keeps. */
export function updateSettings(patch: SettingsPatch): void {
  send({ v, type: "set-settings", patch });
}

/** Shows the file dialog for picking the pi program. */
export function choosePiPath(): void {
  send({ v, type: "choose-pi-path" });
}

/** Shows the folder dialog for new managed worktrees. */
export function chooseWorktreeDirectory(): void {
  send({ v, type: "choose-worktree-directory" });
}

/** Looks for pi again, after you install or update it. */
export function retryPi(): void {
  send({ v, type: "retry-pi" });
}

/** Asks for pi's config files: the global ones, and the shown thread's project's. */
export function requestPiConfigFiles(): void {
  send({ v, type: "get-pi-config-files", threadId: shownId() ?? null });
}

/** Asks for the sign-ins in pi's auth.json. They read as loading until the host answers. */
export function requestPiAccounts(): void {
  useHost.setState({ piAccounts: null });
  send({ v, type: "get-pi-accounts" });
}

/** Shows a file the host offered in Finder. */
export function revealFile(path: string): void {
  send({ v, type: "reveal", path });
}
