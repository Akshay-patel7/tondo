// The fixture player stands in for pi until Stage 3. It replays pi output
// recorded by scripts/record-fixtures.mts at the recorded pace, and sends the
// events that came due in each frame as one batch. It applies every batch to
// its own copy of the thread first, so a page that connects mid-stream gets
// the whole thread as it stands.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFixture, type FixtureEvent } from "../shared/fixture";
import {
  PROTOCOL_VERSION,
  type FixtureName,
  type HostMessage,
  type PlayerStatus,
} from "../shared/protocol";
import {
  applyEvents,
  threadFromMessages,
  type PiEvent,
  type PiMessage,
  type ThreadState,
} from "../shared/thread";

/** The host runs from out/main/host.js, and the stand-in only runs from a checkout. */
const FIXTURES_DIR = path.join(__dirname, "..", "..", "fixtures");

/** The host has no display to sync to, so it batches on a 60 Hz timer. */
const FRAME_MS = 1000 / 60;

export interface Player {
  /** The thread with every batch sent so far applied. */
  readonly thread: ThreadState;
  readonly status: PlayerStatus;
  /** Replays a fixture, replacing any playback in progress. */
  play(fixture: FixtureName, speed: number): Promise<void>;
  stop(): void;
}

/**
 * Opens the 1,000-message transcript and returns a player that sends what it
 * plays through `send`. `messageCount` repeats the transcript to that many
 * messages, so perf can measure a longer thread.
 */
export async function openPlayer(
  send: (message: HostMessage) => void,
  messageCount?: number,
): Promise<Player> {
  const transcript = await readFile(path.join(FIXTURES_DIR, "transcript-1000.json"), "utf8");
  const { messages } = JSON.parse(transcript) as { messages: PiMessage[] };
  let thread = threadFromMessages(messages);
  if (messageCount !== undefined) {
    thread = { ...thread, messages: repeat(thread.messages, messageCount) };
  }

  let status: PlayerStatus = "idle";
  /** Bumped by every play and stop, so a playback that was replaced stops sending. */
  let generation = 0;
  let timer: NodeJS.Timeout | undefined;
  const loaded = new Map<FixtureName, Promise<FixtureEvent[]>>();

  const setStatus = (next: PlayerStatus) => {
    if (next === status) return;
    status = next;
    send({ v: PROTOCOL_VERSION, type: "player", status });
  };

  const cancel = () => {
    generation++;
    clearTimeout(timer);
    timer = undefined;
  };

  const load = (name: FixtureName) => {
    let events = loaded.get(name);
    if (!events) {
      events = readFile(path.join(FIXTURES_DIR, `${name}.jsonl`), "utf8").then(parseFixture);
      loaded.set(name, events);
    }
    return events;
  };

  const play = async (name: FixtureName, speed: number) => {
    cancel();
    const playing = generation;
    setStatus("playing");
    let events: FixtureEvent[];
    try {
      events = await load(name);
    } catch (error) {
      if (playing === generation) setStatus("idle");
      throw error;
    }
    if (playing !== generation) return;

    const start = performance.now();
    let next = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) * speed;
      const batch: PiEvent[] = [];
      while (next < events.length && events[next]!.t <= elapsed) batch.push(events[next++]!.event);
      if (batch.length > 0) {
        thread = applyEvents(thread, batch);
        send({ v: PROTOCOL_VERSION, type: "events", events: batch });
      }
      if (next < events.length) {
        timer = setTimeout(tick, FRAME_MS);
      } else {
        timer = undefined;
        setStatus("idle");
      }
    };
    tick();
  };

  return {
    get thread() {
      return thread;
    },
    get status() {
      return status;
    },
    play,
    stop() {
      cancel();
      setStatus("idle");
    },
  };
}

/**
 * Repeats `messages` up to `count`, cloning each copy. The serializer sends
 * an object it has already sent as a reference to it, so repeating the same
 * objects would make the snapshot cheaper to send than a real thread.
 */
function repeat(messages: readonly PiMessage[], count: number): PiMessage[] {
  return Array.from({ length: count }, (_, index) =>
    structuredClone(messages[index % messages.length]!),
  );
}
