import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { threadFromMessages, type PiMessage, type ThreadState } from "../../shared/thread";
import { useThread } from "../thread/store";

const Transcript = createContext<StoreApi<ThreadState> | null>(null);
const liveTranscript: StoreApi<ThreadState> = {
  getState: useThread.getState,
  getInitialState: useThread.getInitialState,
  setState: useThread.setState,
  subscribe: useThread.subscribe,
};

export function useSavedTranscript(): boolean {
  return useContext(Transcript) !== null;
}

/** Historical tool results must resolve against their page, never the live thread. */
export function useTranscript<T>(select: (thread: ThreadState) => T): T {
  const store = useContext(Transcript);
  return useStore(store ?? liveTranscript, select);
}

export function SavedTranscript({
  messages,
  children,
}: {
  messages: readonly PiMessage[];
  children: ReactNode;
}) {
  const store = useMemo(() => createStore(() => threadFromMessages(messages)), [messages]);
  return <Transcript value={store}>{children}</Transcript>;
}
