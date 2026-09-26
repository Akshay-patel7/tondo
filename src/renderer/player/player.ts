import { create } from "zustand";
import { openThread, receiveEvents } from "../thread/store";
import type { FixtureName, PlayerCommand, PlayerMessage } from "./protocol";

type PlayerStatus = "opening" | "idle" | "playing";

export const usePlayer = create<{ status: PlayerStatus; error: string | null }>()(() => ({
  status: "opening",
  error: null,
}));

let worker: Worker | undefined;

function fail(message: string): void {
  console.error(`Fixture player: ${message}`);
  usePlayer.setState({ status: "idle", error: message });
}

function send(command: PlayerCommand): void {
  if (!worker) throw new Error("startPlayer() must run before the player gets commands");
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker has no origin to target.
  worker.postMessage(command);
}

/** Starts the worker and opens the 1,000-message transcript. */
export function startPlayer(): void {
  worker = new Worker(new URL("./player.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<PlayerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "thread":
        openThread(message.thread);
        // Reopening mid-stream must not end the playback.
        if (usePlayer.getState().status === "opening") usePlayer.setState({ status: "idle" });
        break;
      case "events":
        receiveEvents(message.events);
        break;
      case "done":
        usePlayer.setState({ status: "idle" });
        break;
      case "error":
        fail(message.message);
        break;
    }
  });
  worker.addEventListener("error", (event) => fail(event.message || "the worker failed to load"));
  send({ type: "open" });
}

export function play(fixture: FixtureName, speed: number): void {
  usePlayer.setState({ status: "playing", error: null });
  send({ type: "play", fixture, speed });
}

export function stop(): void {
  send({ type: "stop" });
  usePlayer.setState({ status: "idle" });
}

/** Stands in for switching back to this thread: the timeline mounts from a fresh copy. */
export function reopen(): void {
  send({ type: "reopen" });
}
