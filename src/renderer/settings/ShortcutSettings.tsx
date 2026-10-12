// The Shortcuts section: the app shortcuts you can change. Each one's key cap
// records new keys when you press it.
import { useId, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_TITLES,
  type AppSettings,
  type ShortcutCommand,
} from "../../shared/settings";
import {
  checkShortcuts,
  chordFromKeyEvent,
  chordLabel,
  DEFAULT_SHORTCUTS,
  formatChord,
  parseChord,
  resolveShortcuts,
  shortcutProblems,
} from "../../shared/shortcuts";
import { updateSettings, useHost } from "../connection";
import { isMac } from "../platform";
import { Button } from "../ui/button";
import { CardGroup } from "../ui/card-group";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Footnote, Loading } from "./rows";

/** The command whose new keys you're pressing, and what's wrong with the last ones. */
interface Recording {
  readonly command: ShortcutCommand;
  readonly problem: string | null;
}

export function ShortcutSettings() {
  const overrides = useHost((host) => host.settings?.shortcuts);
  const [recording, setRecording] = useState<Recording | null>(null);
  if (overrides === undefined) return <Loading>Loading settings…</Loading>;
  // settings.json can hold bindings the recorder would refuse. They're off, and their rows say why.
  const { problems } = checkShortcuts(overrides);
  return (
    <>
      <CardGroup>
        {SHORTCUT_COMMANDS.map((command) => (
          <ShortcutRow
            key={command}
            command={command}
            overrides={overrides}
            problems={problems[command]}
            recording={recording?.command === command ? recording : null}
            setRecording={setRecording}
          />
        ))}
      </CardGroup>
      <Footnote>
        {keys("mod+digit1")}–{keys("mod+digit9")} open the sidebar's threads and are kept for that.
      </Footnote>
    </>
  );
}

function ShortcutRow({
  command,
  overrides,
  problems,
  recording,
  setRecording,
}: {
  command: ShortcutCommand;
  overrides: AppSettings["shortcuts"];
  /** What's wrong with the saved binding, which is off until it's fixed. */
  problems: readonly string[];
  recording: Recording | null;
  setRecording: (recording: Recording | null) => void;
}) {
  const id = useId();
  const title = command === "palette" ? "Search" : SHORTCUT_TITLES[command];
  const chord = resolveShortcuts(overrides)[command];
  const customized = Object.hasOwn(overrides, command);
  const titleId = `${id}-title`;
  const changeId = `${id}-change`;
  const problemId = `${id}-problem`;

  /** Ends the recording and puts focus back on the key cap, which the recorder replaced. */
  const finish = () => {
    flushSync(() => setRecording(null));
    document.getElementById(changeId)?.focus();
  };

  /** Saves the binding, and keeps focus in the row while its buttons change. */
  const save = (binding: string | null | "default") => {
    updateSettings({ shortcuts: { [command]: binding } });
    document.getElementById(changeId)?.focus();
  };

  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    // Tab moves on, and leaving the recorder ends the recording.
    if (event.key === "Tab") return;
    event.preventDefault();
    // The keys you press here are for this shortcut, not the app's shortcuts
    // or the page's Escape.
    event.stopPropagation();
    if (event.repeat || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      finish();
      return;
    }
    const pressed = chordFromKeyEvent(event, isMac);
    // A modifier on its own: wait for the key that goes with it.
    if (pressed === null) return;
    const text = formatChord(pressed);
    const binding = text === DEFAULT_SHORTCUTS[command] ? "default" : text;
    const next: Record<string, string | null> = { ...overrides };
    if (binding === "default") delete next[command];
    else next[command] = binding;
    // Problems the saved bindings already had, such as a clash a hand edit made, aren't this
    // change's fault. The host refuses a change on the same terms.
    const had = new Set(shortcutProblems(overrides));
    const refused = shortcutProblems(next).filter((problem) => !had.has(problem));
    if (refused.length > 0) {
      setRecording({ command, problem: refused.join(" ") });
      return;
    }
    save(binding);
    finish();
  };

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-2.5 pr-3 pl-4"
    >
      <p id={titleId} className="min-w-32 flex-1 font-medium">
        {title}
      </p>
      {recording !== null ? (
        <>
          <Input
            data-shortcut-recorder
            autoFocus
            readOnly
            size="sm"
            value=""
            placeholder="Press keys…"
            aria-label={`Shortcut for ${title}`}
            aria-invalid={recording.problem !== null || undefined}
            aria-describedby={recording.problem === null ? undefined : problemId}
            onKeyDown={record}
            onBlur={() => setRecording(null)}
            className="w-28"
          />
          <p className="text-xs text-faint-foreground">Esc cancels</p>
        </>
      ) : (
        <>
          <Kbd
            variant="recorder"
            render={
              <button
                type="button"
                id={changeId}
                onClick={() => setRecording({ command, problem: null })}
              />
            }
          >
            {/* The name says what pressing the cap does, then the keys it shows. */}
            <span className="sr-only">Change shortcut, </span>
            {chord === null ? (
              <span className="text-faint-foreground">Off</span>
            ) : (
              <span>{chordLabel(chord, isMac)}</span>
            )}
          </Kbd>
          {customized || chord !== null ? (
            <div className="flex items-center gap-1">
              {customized ? (
                <Button variant="faint-ghost" size="sm" onClick={() => save("default")}>
                  Reset
                </Button>
              ) : null}
              {chord === null ? null : (
                <Button variant="faint-ghost" size="sm" onClick={() => save(null)}>
                  Turn off
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}
      {recording?.problem ? (
        <p id={problemId} role="alert" className="basis-full text-xs text-destructive">
          {recording.problem}
        </p>
      ) : recording === null && problems.length > 0 ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          {problems.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** How a fixed chord reads on this platform, such as ⌘1 on macOS and Ctrl+1 elsewhere. */
function keys(text: string): string {
  const chord = parseChord(text);
  if (chord === null) throw new Error(`${text} isn't a chord`);
  return chordLabel(chord, isMac);
}
