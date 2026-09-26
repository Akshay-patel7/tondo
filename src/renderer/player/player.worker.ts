// The fixture player stands in for the host until Stage 2. It replays pi
// output recorded by scripts/record-fixtures.mts at the recorded pace, and
// posts the events that came due in each frame as one batch, the way the host
// will post a thread's events. Like the host, it runs the thread reducer too,
// so it can send the whole thread when the page opens it again.
import abortUrl from "../../../fixtures/abort.jsonl?url";
import errorUrl from "../../../fixtures/error.jsonl?url";
import stream1000Url from "../../../fixtures/stream-1000.jsonl?url";
import stream200Url from "../../../fixtures/stream-200.jsonl?url";
import toolsUrl from "../../../fixtures/tools.jsonl?url";
import transcriptUrl from "../../../fixtures/transcript-1000.json?url";
import { parseFixture, type FixtureEvent } from "../../shared/fixture";
import {
  applyEvents,
  threadFromMessages,
  type PiEvent,
  type PiMessage,
  type ThreadState,
} from "../../shared/thread";
import type { FixtureName, PlayerCommand, PlayerMessage } from "./protocol";

const FIXTURE_URLS: Record<FixtureName, string> = {
  "stream-1000": stream1000Url,
  "stream-200": stream200Url,
  tools: toolsUrl,
  error: errorUrl,
  abort: abortUrl,
};

/** The host has no display to sync to, so it will batch on a 60 Hz timer too. */
const FRAME_MS = 1000 / 60;

const loaded = new Map<FixtureName, Promise<FixtureEvent[]>>();
/** The thread as the page has been told about it, once the transcript loaded. */
let thread: ThreadState | undefined;
/** Bumped by every play and stop, so a playback that was replaced stops posting. */
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function post(message: PlayerMessage): void {
  postMessage(message);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
  return response.text();
}

function load(name: FixtureName): Promise<FixtureEvent[]> {
  let events = loaded.get(name);
  if (!events) {
    events = fetchText(FIXTURE_URLS[name]).then(parseFixture);
    loaded.set(name, events);
  }
  return events;
}

async function open(): Promise<void> {
  const { messages } = JSON.parse(await fetchText(transcriptUrl)) as { messages: PiMessage[] };
  thread = threadFromMessages(messages);
  post({ type: "thread", thread });
}

function openedThread(): ThreadState {
  if (!thread) throw new Error("The page must open the transcript before playing or reopening");
  return thread;
}

function stop(): void {
  generation++;
  clearTimeout(timer);
  timer = undefined;
}

async function play(name: FixtureName, speed: number): Promise<void> {
  openedThread();
  stop();
  const playing = generation;
  const events = await load(name);
  if (playing !== generation) return;

  const start = performance.now();
  let next = 0;
  const tick = () => {
    const elapsed = (performance.now() - start) * speed;
    const batch: PiEvent[] = [];
    while (next < events.length && events[next]!.t <= elapsed) batch.push(events[next++]!.event);
    if (batch.length > 0) {
      thread = applyEvents(openedThread(), batch);
      post({ type: "events", events: batch });
    }
    if (next < events.length) {
      timer = setTimeout(tick, FRAME_MS);
    } else {
      timer = undefined;
      post({ type: "done" });
    }
  };
  tick();
}

function run(command: PlayerCommand): Promise<void> {
  switch (command.type) {
    case "open":
      return open();
    case "play":
      return play(command.fixture, command.speed);
    case "stop":
      stop();
      return Promise.resolve();
    case "reopen":
      post({ type: "thread", thread: openedThread() });
      return Promise.resolve();
  }
}

addEventListener("message", (event: MessageEvent<PlayerCommand>) => {
  run(event.data).catch((error: unknown) => {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
});
