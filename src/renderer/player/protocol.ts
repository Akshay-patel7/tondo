import type { PiEvent, ThreadState } from "../../shared/thread";

export const FIXTURES = ["stream-1000", "stream-200", "tools", "error", "abort"] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** What the page asks the fixture player to do. */
export type PlayerCommand =
  | { type: "open" }
  /** `speed` multiplies the recorded pace: 1 replays in real time. */
  | { type: "play"; fixture: FixtureName; speed: number }
  | { type: "stop" }
  /** Send the whole thread again, as the host will when the user switches back to it. */
  | { type: "reopen" };

/** What the fixture player sends back, the way the host will. */
export type PlayerMessage =
  | { type: "thread"; thread: ThreadState }
  | { type: "events"; events: PiEvent[] }
  | { type: "done" }
  | { type: "error"; message: string };
