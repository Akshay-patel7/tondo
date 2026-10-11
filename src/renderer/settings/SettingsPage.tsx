// The settings page. It takes the thread's place beside the sidebar until you
// go Back or press Escape, and every change saves as you make it.
import {
  ArrowLeft,
  CircleAlert,
  Cpu,
  Keyboard,
  KeyRound,
  Monitor,
  Moon,
  SquareTerminal,
  Sun,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  isPoolValue,
  POOL_RANGES,
  type AppSettings,
  type PoolSettings,
} from "../../shared/settings";
import { revealFile, updateSettings, useHost } from "../connection";
import { isMac } from "../platform";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { ScrollArea } from "../ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { AccountsSettings } from "./AccountsSettings";
import { PiSettings } from "./PiSettings";
import { Loading, SectionHeading, SettingsGroup, SettingsRow } from "./rows";
import { ShortcutSettings } from "./ShortcutSettings";
import { closeSettings, takeSettingsOpener, useSettingsPage, type SettingsSection } from "./store";

const SECTIONS: readonly {
  readonly id: SettingsSection;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { id: "appearance", label: "Appearance", icon: SunMoon },
  { id: "pi", label: "pi", icon: SquareTerminal },
  { id: "accounts", label: "Accounts", icon: KeyRound },
  { id: "threads", label: "Threads", icon: Cpu },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

/** Popups and dialogs over the page. Escape closes them before the page. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The shortcut recorder, where Escape stops recording instead. */
const RECORDER = "[data-shortcut-recorder]";

export function SettingsPage() {
  const titleId = useId();
  const section = useSettingsPage((page) => page.section);
  const settingsError = useHost((host) => host.settingsError);
  const settingsFileError = useHost((host) => host.settingsFileError);
  const settingsFile = useHost((host) => host.settingsFilePath);
  const page = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  // Focus starts on the title, and goes back to what opened the page, such as
  // the sidebar's Settings button, if it's still there when the page closes.
  // An opener in the thread, such as the composer, left with the thread, so
  // the thread's composer takes focus once the thread is back. The title
  // shows focus if the opener did, as when a shortcut opened the page.
  useLayoutEffect(() => {
    const { element: opener, focusVisible } = takeSettingsOpener();
    title.current?.focus({ focusVisible });
    return () => {
      if (!(opener instanceof HTMLElement) || opener === document.body) return;
      if (opener.isConnected) {
        opener.focus();
        return;
      }
      // The thread comes back in the same commit that removes the page.
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return;
        document.querySelector<HTMLElement>('[role="textbox"][aria-label="Message"]')?.focus();
      });
    };
  }, []);

  useEffect(() => {
    // Capturing sees the key before a popup's own handler closes the popup,
    // so the popup is still there to take this Escape.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector(OVERLAYS)) return;
      // Escape in the sidebar, such as while renaming a thread, stays there.
      const { target } = event;
      if (
        target instanceof Element &&
        target !== document.body &&
        (!page.current?.contains(target) || target.closest(RECORDER))
      ) {
        return;
      }
      event.preventDefault();
      // Leaving a number field saves the number typed in it.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      closeSettings();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return (
    <section
      ref={page}
      aria-labelledby={titleId}
      className="@container flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-4 pb-16 @3xl:flex-row @3xl:gap-12 @3xl:px-10">
          <div className="flex shrink-0 flex-col gap-4 @3xl:sticky @3xl:top-4 @3xl:w-44 @3xl:self-start">
            <div className="flex flex-col items-start gap-2">
              <Button variant="ghost" size="sm" className="-ml-1" onClick={closeSettings}>
                <ArrowLeft aria-hidden />
                Back
              </Button>
              <h1
                ref={title}
                id={titleId}
                tabIndex={-1}
                className="rounded-control px-1.5 text-xl font-semibold outline-none focus-visible:focus-ring"
              >
                Settings
              </h1>
            </div>
            <nav aria-label="Settings sections">
              <ul className="flex flex-wrap gap-1 @3xl:flex-col">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={section === id ? "page" : undefined}
                      onClick={() => useSettingsPage.setState({ section: id })}
                      className="flex h-8 items-center gap-2 rounded-control px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-foreground focus-visible:focus-ring aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground @3xl:w-full [&_svg]:size-4 [&_svg]:shrink-0"
                    >
                      <Icon aria-hidden />
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-6 @3xl:pt-10">
            {settingsFileError === null ? null : (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertTitle>Tondo can't use its settings file</AlertTitle>
                <AlertDescription className="break-words">
                  {settingsFileError}. Tondo uses the defaults for what it can't read.{" "}
                  {settingsFile === null ? null : (
                    <Button
                      variant="link"
                      size="xs"
                      className="-ml-2"
                      onClick={() => revealFile(settingsFile)}
                    >
                      {isMac ? "Show in Finder" : "Show in folder"}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {settingsError === null ? null : (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertTitle>Your change wasn't saved</AlertTitle>
                <AlertDescription>{settingsError}</AlertDescription>
              </Alert>
            )}
            <Section section={section} />
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}

function Section({ section }: { section: SettingsSection }) {
  switch (section) {
    case "appearance":
      return <AppearanceSettings />;
    case "pi":
      return <PiSettings />;
    case "accounts":
      return <AccountsSettings />;
    case "threads":
      return <ThreadSettings />;
    case "shortcuts":
      return <ShortcutSettings />;
  }
}

function AppearanceSettings() {
  const theme = useHost((host) => host.settings?.theme);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeading title="Appearance" />
      {theme === undefined ? (
        <Loading>Loading settings…</Loading>
      ) : (
        <SettingsGroup>
          <SettingsRow
            title={<span id={labelId}>Theme</span>}
            description="System follows your computer's appearance."
            control={
              <ToggleGroup
                aria-labelledby={labelId}
                variant="outline"
                size="sm"
                value={[theme]}
                onValueChange={([chosen]) => {
                  // Clicking the chosen theme again unpresses it, which changes nothing.
                  if (chosen !== undefined) updateSettings({ theme: chosen });
                }}
              >
                <ToggleGroupItem value="system">
                  <Monitor aria-hidden />
                  System
                </ToggleGroupItem>
                <ToggleGroupItem value="light">
                  <Sun aria-hidden />
                  Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark">
                  <Moon aria-hidden />
                  Dark
                </ToggleGroupItem>
              </ToggleGroup>
            }
          />
        </SettingsGroup>
      )}
    </div>
  );
}

function ThreadSettings() {
  const settings = useHost((host) => host.settings);
  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Threads"
        description="Each thread runs its own pi. Tondo stops the ones you aren't using, so they don't fill your memory."
      />
      {settings === null ? (
        <Loading>Loading settings…</Loading>
      ) : (
        <>
          <SettingsGroup>
            <PoolRow
              settings={settings}
              field="maxLive"
              title="pi processes kept running"
              description="When more are running, Tondo stops the pi of the thread you used longest ago."
              fewer="Fewer pi processes"
              more="More pi processes"
            />
            <PoolRow
              settings={settings}
              field="idleMinutes"
              title="Minutes before a hidden idle thread's pi stops"
              description="Come back to a thread sooner, and its pi is still running."
              fewer="Fewer minutes"
              more="More minutes"
            />
          </SettingsGroup>
          <p className="text-xs text-muted-foreground">
            The thread on screen and threads where pi is busy never stop.
          </p>
        </>
      )}
    </div>
  );
}

/** A pool limit, saved when you leave the field, step it or press its arrows. */
function PoolRow({
  settings,
  field,
  title,
  description,
  fewer,
  more,
}: {
  settings: AppSettings;
  field: keyof PoolSettings;
  title: string;
  description: string;
  fewer: string;
  more: string;
}) {
  const id = useId();
  const saved = settings.pool[field];
  // What you typed lasts until the host answers with new settings, which hold
  // the value it saved, or the old one if it refused.
  const [draft, setDraft] = useState<{
    readonly value: number | null;
    readonly from: AppSettings;
  } | null>(null);
  const value = draft !== null && draft.from === settings ? draft.value : saved;
  const { min, max } = POOL_RANGES[field];
  return (
    <SettingsRow
      title={<Label htmlFor={id}>{title}</Label>}
      description={description}
      control={
        <NumberField
          id={id}
          className="w-32"
          value={value}
          min={min}
          max={max}
          onValueChange={(next) => setDraft({ value: next, from: settings })}
          onValueCommitted={(next) => {
            if (next !== saved && isPoolValue(field, next)) {
              updateSettings({ pool: { [field]: next } });
            } else {
              setDraft(null);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={fewer} />
            <NumberFieldInput />
            <NumberFieldIncrement aria-label={more} />
          </NumberFieldGroup>
        </NumberField>
      }
    />
  );
}
