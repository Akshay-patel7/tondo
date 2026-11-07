import { create } from "zustand";
import { loadRemoteDraft, remoteDraftKey } from "./draft";
import { forgetThread, rememberedThread, rememberThread } from "./storage";
import {
  showRemoteThread,
  showRemoteThreads,
  startRemoteNavigation,
  useRemoteLocation,
} from "./navigation";
import { RemoteBackoff } from "./reconnect";
import {
  REMOTE_CLOSE_UNAVAILABLE,
  REMOTE_LOCAL_ONLY,
  REMOTE_REQUEST_BYTES,
  remoteRequestAllowed,
} from "../../shared/remote";
import { PROTOCOL_VERSION as v, type ClientMessage, type HostMessage } from "../../shared/protocol";
import { attachBrowserTransport, receiveBrowserMessage, useHost } from "../connection";

export const useRemoteConnection = create<{
  state: "pairing" | "connecting" | "connected" | "offline";
  error: string | null;
  historyOmitted: boolean;
  openingThreadId: string | null;
  creating: boolean;
}>(() => ({
  state: "connecting",
  error: null,
  historyOmitted: false,
  openingThreadId: null,
  creating: false,
}));
let socket: WebSocket | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const backoff = new RemoteBackoff();
let generation = 0;
let selection = 0;
const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

/** Requests the page makes by itself, such as loading saved history or changes. */
function requestFromPage(message: ClientMessage): void {
  if (!remoteRequestAllowed(message)) {
    // These wait for a reply. Fail them now rather than leave their dialog loading.
    if (message.type === "preview-file" || message.type === "choose-files")
      throw new Error(REMOTE_LOCAL_ONLY);
    showError(new Error(REMOTE_LOCAL_ONLY));
    return;
  }
  void remoteRequest(message).catch(showError);
}

export function remoteRequest(message: ClientMessage): Promise<void> {
  const current = socket;
  if (!current || current.readyState !== WebSocket.OPEN)
    return Promise.reject(new Error("Not connected. Your message has not been sent."));
  if (pending.size >= 32)
    return Promise.reject(new Error("Wait for your Mac to finish the pending requests."));
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ id, message });
  if (new TextEncoder().encode(payload).byteLength > REMOTE_REQUEST_BYTES)
    return Promise.reject(
      new Error(
        "This message is too large for remote access (64 KiB maximum). Your draft is unchanged.",
      ),
    );
  return new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    current.send(payload);
  });
}

export function selectRemoteThread(threadId: string): void {
  showRemoteThread(threadId);
  openThread(threadId);
}

function openThread(threadId: string): void {
  const attempt = ++selection;
  useRemoteConnection.setState({ openingThreadId: threadId });
  // Selecting a destination is safe offline; only send it after reconnecting.
  if (useRemoteConnection.getState().state !== "connected") return;
  void remoteRequest({ v, type: "open-thread", threadId })
    .catch((error: unknown) => {
      if (attempt === selection && useRemoteLocation.getState().threadId === threadId)
        showError(error);
    })
    .finally(() => {
      if (attempt === selection) useRemoteConnection.setState({ openingThreadId: null });
    });
}

export async function createRemoteThread(projectId: number): Promise<void> {
  if (useRemoteConnection.getState().creating) return;
  useRemoteConnection.setState({ creating: true });
  const previous = useHost.getState().thread?.id;
  try {
    await remoteRequest({ v, type: "new-thread", projectId });
    const thread = useHost.getState().thread;
    if (!thread || thread.id === previous) throw new Error("The new thread could not be opened.");
    showRemoteThread(thread.id);
  } finally {
    useRemoteConnection.setState({ creating: false });
  }
}

function showError(error: unknown): void {
  useRemoteConnection.setState({ error: error instanceof Error ? error.message : String(error) });
}

function disconnected(): void {
  backoff.disconnected(performance.now());
  selection++;
  useRemoteConnection.setState({ openingThreadId: null });
  useHost.setState({ connection: "reconnecting" });
  for (const request of pending.values())
    request.reject(
      new Error(
        "Connection lost before confirmation. Check the thread before sending again; nothing will be replayed automatically.",
      ),
    );
  pending.clear();
}

export async function pairRemote(code: string): Promise<void> {
  const response = await fetch("/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });
  if (!response.ok) throw new Error(await response.text());
  await connectRemote();
  if (useRemoteConnection.getState().state === "pairing")
    throw new Error(
      "This browser could not keep its pairing cookie. Allow cookies for this site and try again.",
    );
}

async function connectRemote(): Promise<void> {
  clearTimeout(timer);
  if (document.visibilityState === "hidden") return;
  const attempt = ++generation;
  useRemoteConnection.setState({ state: "connecting" });
  try {
    const response = await fetch("/session", { cache: "no-store" });
    if (attempt !== generation) return;
    if (!response.ok) throw new Error("The Mac is unavailable.");
    const session = (await response.json()) as { paired: boolean };
    if (attempt !== generation) return;
    if (!session.paired) {
      useRemoteConnection.setState({ state: "pairing" });
      return;
    }
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/socket`,
    );
    socket?.close();
    socket = ws;
    let reopening = true;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      attachBrowserTransport({ postMessage: requestFromPage, close: () => {} });
    });
    ws.addEventListener("message", ({ data }) => {
      if (socket !== ws) return;
      const message = JSON.parse(data as string) as HostMessage;
      if (message.type === "remote-result") {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error));
        else request?.resolve();
        return;
      }
      if (message.v === v && message.type === "snapshot" && message.thread) {
        loadRemoteDraft(remoteDraftKey(message.thread.id));
        rememberThread(message.thread.id);
      }
      receiveBrowserMessage(message);
      if (message.type === "snapshot" && message.v === v)
        useRemoteConnection.setState({ historyOmitted: message.historyOmitted ?? false });
      if (message.v === v && message.type === "sidebar" && reopening) {
        reopening = false;
        backoff.connected(performance.now());
        useRemoteConnection.setState({ state: "connected", error: null });
        const id = useRemoteLocation.getState().threadId ?? rememberedThread();
        if (id) {
          if (
            message.projects.some((project) => project.threads.some((thread) => thread.id === id))
          )
            openThread(id);
          else {
            forgetThread();
            showRemoteThreads();
          }
        }
      }
    });
    ws.addEventListener("error", () => ws.close());
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = undefined;
      disconnected();
      if (event.code === REMOTE_CLOSE_UNAVAILABLE) {
        // Do not repeatedly request a large snapshot from an overloaded Mac or connection.
        forgetThread();
        showRemoteThreads();
        useHost.setState({ thread: null });
        useRemoteConnection.setState({
          state: "offline",
          error: event.reason || "Remote output is too large. Reconnect to choose another thread.",
        });
        return;
      }
      if (event.code === 1008) {
        useRemoteConnection.setState({
          state: "pairing",
          error: event.reason || "Pair this browser again.",
        });
        return;
      }
      useRemoteConnection.setState({
        state: "offline",
        error: event.reason || "Disconnected. Reconnecting when your Mac is available…",
      });
      scheduleReconnect();
    });
  } catch {
    if (attempt !== generation) return;
    useRemoteConnection.setState({
      state: "offline",
      error: "Cannot reach your Mac. Check Tailscale and that Tondo is running.",
    });
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (document.visibilityState === "hidden" || !navigator.onLine) return;
  timer = setTimeout(() => {
    void connectRemote();
  }, backoff.delay(performance.now()));
}

export function retryRemoteConnection(): void {
  void connectRemote();
}

export function startRemoteConnection(): void {
  startRemoteNavigation(openThread);
  document.addEventListener("visibilitychange", () => {
    generation++;
    clearTimeout(timer);
    if (document.visibilityState === "hidden") {
      const ws = socket;
      socket = undefined;
      ws?.close();
      disconnected();
      useRemoteConnection.setState({ state: "offline" });
    } else void connectRemote();
  });
  window.addEventListener("offline", () => {
    generation++;
    clearTimeout(timer);
    const ws = socket;
    socket = undefined;
    ws?.close();
    disconnected();
    useRemoteConnection.setState({
      state: "offline",
      error: "Offline. Your draft stays on this device.",
    });
  });
  window.addEventListener("online", () => {
    if (!socket) void connectRemote();
  });
  void connectRemote();
}
