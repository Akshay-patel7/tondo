import { create } from "zustand";
import {
  applyEvents,
  threadFromMessages,
  type PiEvent,
  type ThreadState,
} from "../../shared/thread";

/** The open thread. Components read it through atomic selectors. */
export const useThread = create<ThreadState>()(() => threadFromMessages([]));

/** Changes each time a thread opens, so its timeline mounts fresh. */
export const useThreadKey = create<number>()(() => 0);

/** Events applied since the last frame, waiting to be shown. */
let pending: ThreadState | null = null;
let frame: number | undefined;

/**
 * Applies events as they arrive and shows the result on the next frame, so
 * React commits at most once per frame however many batches came in.
 */
export function receiveEvents(events: readonly PiEvent[]): void {
  pending = applyEvents(pending ?? useThread.getState(), events);
  frame ??= requestAnimationFrame(() => {
    frame = undefined;
    if (!pending) return;
    useThread.setState(pending, true);
    pending = null;
  });
}

/** Shows a whole thread, replacing the one on screen. */
export function openThread(thread: ThreadState): void {
  pending = null;
  useThread.setState(thread, true);
  useThreadKey.setState((key) => key + 1, true);
}
