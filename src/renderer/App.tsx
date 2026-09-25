import { useState } from "react";
import { play, reopen, stop, usePlayer } from "./player/player";
import { FIXTURES, type FixtureName } from "./player/protocol";
import { useThreadKey } from "./thread/store";
import { Timeline } from "./timeline/Timeline";

export function App() {
  const threadKey = useThreadKey((key) => key);
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="app-drag relative flex h-10 shrink-0 items-center justify-center text-sm font-medium">
        Tondo
        <PlayerControls />
      </header>
      <main className="min-h-0 flex-1">
        <Timeline key={threadKey} />
      </main>
      <Composer />
    </div>
  );
}

/** Stage 1 stand-in for a running pi: replays a recorded fixture. */
function PlayerControls() {
  const status = usePlayer((player) => player.status);
  const error = usePlayer((player) => player.error);
  const [fixture, setFixture] = useState<FixtureName>("stream-1000");

  return (
    <div
      className="app-no-drag absolute right-3 flex items-center gap-2 text-xs font-normal"
      data-testid="player"
      data-status={status}
    >
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : null}
      <select
        aria-label="Fixture"
        value={fixture}
        onChange={(event) => setFixture(event.target.value as FixtureName)}
        className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
      >
        {FIXTURES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {status === "playing" ? (
        <button
          type="button"
          onClick={stop}
          className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          disabled={status === "opening"}
          onClick={() => play(fixture, 1)}
          className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-50 dark:border-neutral-700"
        >
          Play
        </button>
      )}
      <button
        type="button"
        disabled={status === "opening"}
        onClick={reopen}
        className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-50 dark:border-neutral-700"
      >
        Reopen
      </button>
    </div>
  );
}

function Composer() {
  const [draft, setDraft] = useState("");
  return (
    <div className="shrink-0 px-4 pb-4">
      <textarea
        aria-label="Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        placeholder="Message pi"
        className="mx-auto block w-full max-w-3xl resize-none rounded-xl border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
    </div>
  );
}
