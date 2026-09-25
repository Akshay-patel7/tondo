// Fixtures are pi's stdout recorded by scripts/record-fixtures.mts, one JSON
// line per record: { "t": milliseconds since the prompt, "record": ... }.
import type { PiEvent } from "./thread";

export interface FixtureEvent {
  /** Milliseconds from the prompt to this event. */
  readonly t: number;
  readonly event: PiEvent;
}

/** Parses a recorded fixture and keeps the session events, in order. */
export function parseFixture(text: string): FixtureEvent[] {
  const events: FixtureEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const { t, record } = JSON.parse(line) as { t: number; record: { type: string } };
    // Command responses share stdout with the events. They aren't events.
    if (record.type === "response") continue;
    events.push({ t, event: record as PiEvent });
  }
  return events;
}
