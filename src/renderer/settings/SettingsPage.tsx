// The settings page. It takes the thread's place beside the sidebar until you
// go Back in the header or press Escape, and every change saves as you make it.
import {
  CircleAlert,
  Cpu,
  Keyboard,
  KeyRound,
  SquareTerminal,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { revealFile, useHost } from "../connection";
import { isMac } from "../platform";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { AccountsSettings } from "./AccountsSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { PiSettings } from "./PiSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { closeSettings, takeSettingsOpener, useSettingsPage, type SettingsSection } from "./store";
import { ThreadSettings } from "./ThreadSettings";

const SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "pi",
  "accounts",
  "threads",
  "shortcuts",
];

const SECTION_INFO: Readonly<
  Record<
    SettingsSection,
    { readonly title: string; readonly icon: LucideIcon; readonly description: string }
  >
> = {
  appearance: {
    title: "Appearance",
    icon: Sun,
    description: "How Tondo looks. Each palette has a light and a dark version.",
  },
  pi: {
    title: "pi",
    icon: SquareTerminal,
    description: "The pi program Tondo runs for each thread.",
  },
  accounts: {
    title: "Accounts",
    icon: KeyRound,
    description: "The providers pi is signed in to. Tondo never reads their tokens or keys.",
  },
  threads: {
    title: "Threads",
    icon: Cpu,
    description:
      "Each thread runs its own pi. Tondo stops the ones you aren't using, so they don't fill your memory.",
  },
  shortcuts: {
    title: "Shortcuts",
    icon: Keyboard,
    description:
      "Click a shortcut to record a new one. Composer and dialog keys follow pi's terminal UI and can't change.",
  },
};

/** Popups and dialogs over the page. Escape closes them before the page. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The shortcut recorder, where Escape stops recording instead. */
const RECORDER = "[data-shortcut-recorder]";

export function SettingsPage() {
  const section = useSettingsPage((page) => page.section);
  const settingsError = useHost((host) => host.settingsError);
  const settingsFileError = useHost((host) => host.settingsFileError);
  const settingsFile = useHost((host) => host.settingsFilePath);
  const page = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { title, description } = SECTION_INFO[section];

  // The header shows the page's title and Back, so focus starts on the
  // section's heading, and goes back to what opened the page, such as the
  // sidebar's Settings button, if it's still there when the page closes. An
  // opener in the thread, such as the composer, left with the thread, so the
  // thread's composer takes focus once the thread is back. The heading shows
  // focus if the opener did, as when a shortcut opened the page.
  useLayoutEffect(() => {
    const { element: opener, focusVisible } = takeSettingsOpener();
    heading.current?.focus({ focusVisible });
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
      // Escape on the page, or in the header that holds its Back, goes back.
      // In the sidebar, such as while renaming a thread, it stays there.
      const { target } = event;
      if (target instanceof Element && target !== document.body) {
        const ours = page.current?.contains(target) || target.closest("header") !== null;
        if (!ours || target.closest(RECORDER)) return;
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
      aria-label="Settings"
      className="@container flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-8 pt-10 pb-16">
          <div className="mx-auto flex w-full max-w-220 flex-col gap-6 @3xl:flex-row @3xl:items-start @3xl:gap-12">
            {/* The nav keeps its place while a long section scrolls under the page's top padding. */}
            <nav
              aria-label="Settings sections"
              className="shrink-0 @3xl:sticky @3xl:top-10 @3xl:w-44"
            >
              <ul className="flex flex-wrap gap-0.5 @3xl:flex-col">
                {SECTIONS.map((id) => {
                  const { title: label, icon: Icon } = SECTION_INFO[id];
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-current={section === id ? "page" : undefined}
                        onClick={() => useSettingsPage.setState({ section: id })}
                        className="flex h-8 items-center gap-2 rounded-control px-2.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:focus-ring aria-[current=page]:bg-selected aria-[current=page]:text-foreground @3xl:w-full [&_svg]:size-4 [&_svg]:shrink-0"
                      >
                        <Icon aria-hidden />
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="flex min-w-0 flex-1 flex-col gap-6">
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
              <div className="flex flex-col gap-1">
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="self-start rounded-chip text-title font-semibold outline-none focus-visible:focus-ring"
                >
                  {title}
                </h2>
                <p className="text-pretty text-muted-foreground">{description}</p>
              </div>
              <Section section={section} />
            </div>
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
