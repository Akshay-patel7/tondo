import { create } from "zustand";
import { rememberedThread } from "./storage";

interface RemoteLocation {
  readonly threadId: string | null;
}

export const useRemoteLocation = create<RemoteLocation>(() => ({ threadId: null }));

function locationFromHistory(): RemoteLocation | null {
  const state: unknown = window.history.state;
  if (
    typeof state !== "object" ||
    state === null ||
    !("tondoRemote" in state) ||
    state.tondoRemote !== true ||
    !("threadId" in state) ||
    (state.threadId !== null && typeof state.threadId !== "string")
  )
    return null;
  return { threadId: state.threadId };
}

function push(threadId: string | null): void {
  window.history.pushState({ tondoRemote: true, threadId }, "");
  useRemoteLocation.setState({ threadId });
}

/** Keep a list entry behind each thread, including a restored thread on first visit. */
export function startRemoteNavigation(open: (threadId: string) => void): void {
  const saved = locationFromHistory();
  if (saved) useRemoteLocation.setState(saved);
  else {
    window.history.replaceState({ tondoRemote: true, threadId: null }, "");
    const threadId = rememberedThread();
    if (threadId) push(threadId);
  }
  window.addEventListener("popstate", () => {
    const location = locationFromHistory() ?? { threadId: null };
    useRemoteLocation.setState(location);
    if (location.threadId) open(location.threadId);
  });
}

export function showRemoteThread(threadId: string): void {
  if (useRemoteLocation.getState().threadId !== threadId) push(threadId);
}

export function showRemoteThreads(): void {
  if (useRemoteLocation.getState().threadId === null) return;
  window.history.back();
}
