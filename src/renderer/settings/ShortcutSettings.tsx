// The Shortcuts section: the app shortcuts you can change, with a recorder
// for new keys, and the keys that stay as they are.
import { useId, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_TITLES,
  type AppSettings,
  type ShortcutCommand,
} from "../../shared/settings";
import {
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
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { GroupHeading, Loading, SectionHeading, SettingsGroup } from "./rows";

/** The command whose new keys you're pressing, and what's wrong with the last ones. */
interface Recording {
  readonly command: ShortcutCommand;
  readonly problem: string | null;
}

export function ShortcutSettings() {
  const overrides = useHost((host) => host.settings?.shortcuts);
  const [recording, setRecording] = useState<Recording | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Shortcuts"
        description={`Press Change, then the keys you want. Each shortcut needs ${isMac ? "⌘" : "Ctrl"}.`}
      />
      {overrides === undefined ? (
        <Loading>Loading settings…</Loading>
      ) : (
        <SettingsGroup>
          {SHORTCUT_COMMANDS.map((command) => (
            <ShortcutRow
              key={command}
              command={command}
              overrides={overrides}
              recording={recording?.command === command ? recording : null}
              setRecording={setRecording}
            />
          ))}
        </SettingsGroup>
      )}
      <FixedKeys />
    </div>
  );
}

function ShortcutRow({
  command,
  overrides,
  recording,
  setRecording,
}: {
  command: ShortcutCommand;
  overrides: AppSettings["shortcuts"];
  recording: Recording | null;
  setRecording: (recording: Recording | null) => void;
}) {
  const id = useId();
  const title = SHORTCUT_TITLES[command];
  const chord = resolveShortcuts(overrides)[command];
  const customized = Object.hasOwn(overrides, command);
  const titleId = `${id}-title`;
  const changeId = `${id}-change`;
  const problemId = `${id}-problem`;

  /** Ends the recording and puts focus back on Change, which the recorder replaced. */
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
    const problems = shortcutProblems(next);
    if (problems.length > 0) {
      setRecording({ command, problem: problems.join(" ") });
      return;
    }
    save(binding);
    finish();
  };

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
    >
      <p id={titleId} className="min-w-32 flex-1 text-sm font-medium">
        {title}
      </p>
      <div className="flex h-8 w-36 items-center justify-end">
        {recording !== null ? (
          <Input
            data-shortcut-recorder
            autoFocus
            readOnly
            value=""
            placeholder="Press keys…"
            aria-label={`Shortcut for ${title}`}
            aria-invalid={recording.problem !== null || undefined}
            aria-describedby={recording.problem === null ? undefined : problemId}
            onKeyDown={record}
            onBlur={() => setRecording(null)}
          />
        ) : chord === null ? (
          <p className="text-sm text-muted-foreground">Off</p>
        ) : (
          <Kbd>{chordLabel(chord, isMac)}</Kbd>
        )}
      </div>
      <div className="flex w-48 items-center gap-1">
        {recording !== null ? (
          <p className="text-xs text-muted-foreground">Esc cancels</p>
        ) : (
          <>
            <Button
              id={changeId}
              variant="outline"
              size="xs"
              onClick={() => setRecording({ command, problem: null })}
            >
              Change
            </Button>
            {customized ? (
              <Button variant="ghost" size="xs" onClick={() => save("default")}>
                Reset
              </Button>
            ) : null}
            {chord === null ? null : (
              <Button variant="ghost" size="xs" onClick={() => save(null)}>
                Turn off
              </Button>
            )}
          </>
        )}
      </div>
      {recording?.problem ? (
        <p id={problemId} role="alert" className="basis-full text-xs text-destructive">
          {recording.problem}
        </p>
      ) : null}
    </div>
  );
}

/** How a fixed chord reads on this platform, such as ⌥↩ on macOS and Alt+Enter elsewhere. */
function keys(text: string): string {
  const chord = parseChord(text);
  if (chord === null) throw new Error(`${text} isn't a chord`);
  return chordLabel(chord, isMac);
}

/** A key to show, or a word between keys. */
type KeyPart = string | { readonly word: string };

const TO = { word: "to" };
const OR = { word: "or" };

/** The keys from /hotkeys that shortcuts can't change. */
const FIXED_KEYS: readonly {
  readonly title: string;
  readonly rows: readonly (readonly [action: string, parts: readonly KeyPart[]])[];
}[] = [
  {
    title: "Anywhere",
    rows: [["The sidebar's first nine threads", [keys("mod+digit1"), TO, keys("mod+digit9")]]],
  },
  {
    title: "Composer",
    rows: [
      ["Send, or steer pi while it works", [keys("enter")]],
      ["Queue a follow-up", [keys("alt+enter")]],
      ["Take queued messages back to edit", [keys("alt+arrowup")]],
      ["Stop pi", ["Esc"]],
      ["New line", [keys("shift+enter")]],
      ["Slash commands: Tab completes one, Enter runs it", ["/"]],
    ],
  },
  {
    title: "Extension dialogs",
    rows: [
      ["Move", [keys("arrowup"), keys("arrowdown")]],
      ["Pick or submit", [keys("enter"), OR, "1", TO, "9"]],
      ["Cancel", ["Esc"]],
    ],
  },
];

function FixedKeys() {
  return (
    <div className="flex flex-col gap-2">
      <GroupHeading title="Fixed keys" description="These keys stay as they are." />
      <SettingsGroup>
        {FIXED_KEYS.map(({ title, rows }) => (
          <div key={title} className="flex flex-col gap-2 px-4 py-3">
            <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
            <dl className="flex flex-col gap-1.5">
              {rows.map(([action, parts]) => (
                <div key={action} className="flex items-center justify-between gap-4">
                  <dt className="min-w-0 text-sm">{action}</dt>
                  <dd className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {parts.map((part) =>
                      typeof part === "string" ? (
                        <Kbd key={part}>{part}</Kbd>
                      ) : (
                        <span key={part.word}>{part.word}</span>
                      ),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}
