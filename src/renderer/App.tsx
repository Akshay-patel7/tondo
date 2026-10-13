import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import type { PaletteSetting } from "../shared/settings";
import { Banners } from "./banners/Banners";
import { runAppCommand } from "./commands";
import { Composer } from "./composer/Composer";
import { QueueList } from "./composer/QueueList";
import { checkPiUpdates, useHost } from "./connection";
import { useTerminals } from "./terminal/store";
import { DialogPanel } from "./extensionUi/DialogPanel";
import { DiffPanel, useDiffPanel } from "./diffs/DiffPanel";
import { useExtensionUi } from "./extensionUi/store";
import { StatusRow, Widgets } from "./extensionUi/Widgets";
import { GitPill } from "./git/GitPill";
import { PiSetup } from "./onboarding/PiSetup";
import { SignInPrompt } from "./onboarding/SignInPrompt";
import { CommandPalette } from "./palette/CommandPalette";
import { closePalette, usePalette } from "./palette/store";
import { isMac } from "./platform";
import { NoThread } from "./project/NoThread";
import { TrustPrompt } from "./project/TrustPrompt";
import { useSettingsPage } from "./settings/store";
import { PiUpdateIndicator } from "./settings/PiUpdateIndicator";
import { Sheets } from "./sheets/Sheets";
import { appCommand } from "./shortcuts";
import { toggleSidebarShown, useChangesPanelShown, useSidebarShown } from "./sidebar/layout";
import { Sidebar } from "./sidebar/Sidebar";
import { Header } from "./shell/Header";
import { useThreadKey } from "./thread/store";
import { Timeline } from "./timeline/Timeline";
import { Toasts } from "./toasts/Toasts";

const TerminalDrawer = lazy(() => import("./terminal/TerminalDrawer"));
const SettingsPage = lazy(() =>
  import("./settings/SettingsPage").then((settings) => ({ default: settings.SettingsPage })),
);

let paletteSwitchFrame = 0;

/**
 * Puts `palette` on <html>, where index.css picks its colors. Like a scheme
 * change (main.tsx), it swaps every color token at once, so theme-switching
 * holds transitions off until the new colors have painted.
 */
function applyPalette(palette: PaletteSetting): void {
  const root = document.documentElement;
  if (root.dataset.palette === palette) return;
  root.classList.add("theme-switching");
  root.dataset.palette = palette;
  cancelAnimationFrame(paletteSwitchFrame);
  paletteSwitchFrame = requestAnimationFrame(() => {
    paletteSwitchFrame = requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}

export function App() {
  const sidebarShown = useSidebarShown();
  const paletteOpen = usePalette((open) => open);
  const title = useExtensionUi((ui) => ui.title);
  // Until the host sends the settings, the page keeps the palette it has: the
  // default, which index.css gives :root, or the last one while it reconnects.
  const colorPalette = useHost((host) => host.settings?.palette);
  const connected = useHost((host) => host.connection === "connected");
  const piFound = useHost((host) => host.piEnv?.state === "found");
  useEffect(() => {
    if (connected && piFound) checkPiUpdates(false);
  }, [connected, piFound]);

  // Before paint, so no frame shows the new settings in the old colors.
  useLayoutEffect(() => {
    if (colorPalette !== undefined) applyPalette(colorPalette);
  }, [colorPalette]);

  // An extension's setTitle names the window while its thread is on screen.
  useEffect(() => {
    document.title = title ?? "Tondo";
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Holding a shortcut down would start a thread, or a pi, for every repeat.
      if (event.repeat || event.isComposing) return;
      // On Linux, Ctrl+K/B/N belong to the shell while its terminal has focus.
      if (!isMac && event.target instanceof Element && event.target.closest(".xterm")) return;
      const command = appCommand(event, isMac);
      if (!command) return;
      event.preventDefault();
      // Like the sidebar's buttons, its shortcut also shows it in a window too narrow for it.
      if (command.type === "sidebar" && useHost.getState().connection === "connected") {
        closePalette();
        toggleSidebarShown();
        return;
      }
      runAppCommand(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-background font-sans text-foreground">
      {sidebarShown ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header sidebarHidden={!sidebarShown} />
        <Body />
      </div>
      <Toasts />
      <Sheets />
      {paletteOpen ? <CommandPalette /> : null}
    </div>
  );
}

function Body() {
  const settingsOpen = useSettingsPage((page) => page.open);
  const threadId = useHost((host) => host.thread?.id);
  const project = useHost((host) => host.thread?.project);
  const askingTrust = useHost((host) => host.thread?.askingTrust ?? false);
  // Set when the thread's pi couldn't start because Tondo found no pi it can run.
  const piProblem = useHost((host) => {
    const pi = host.thread?.pi;
    return pi?.state === "exited" ? pi.problem : undefined;
  });
  if (settingsOpen)
    return (
      <Suspense
        fallback={
          <p role="status" className="p-3 text-sm">
            Loading settings…
          </p>
        }
      >
        <SettingsPage />
      </Suspense>
    );
  if (project === undefined) return <NoThread />;
  // Keyed by thread, so each thread's question takes focus when you open it.
  if (askingTrust) return <TrustPrompt key={threadId} project={project} />;
  if (piProblem) return <PiSetup key={threadId} problem={piProblem} />;
  return <Thread />;
}

function Thread() {
  const threadId = useHost((host) => host.thread?.id);
  const threadKey = useThreadKey((key) => key);
  const terminal = useTerminals((terminals) => (threadId ? terminals.get(threadId) : undefined));
  const asking = useExtensionUi((ui) => ui.dialogs.length > 0);
  const changesOpen = useDiffPanel((open) => open);
  useChangesPanelShown(changesOpen);
  const needsSignIn = useHost((host) => {
    const pi = host.thread?.pi;
    return pi?.state === "ready" && !pi.session.signedIn;
  });
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toasts stay inside the transcript's box (toast-stack in index.css). */}
        <main className="min-h-0 flex-1 [anchor-name:--transcript]">
          <Timeline key={threadKey} />
        </main>
        {/* When the terminal drawer needs the room, the footer gives up height and clips. The
            clip margin keeps the composer card's shadow, which reaches 20px past the footer. */}
        <footer className="min-h-0 overflow-clip px-8 pb-4 [overflow-clip-margin:20px]">
          <div className="mx-auto max-w-176">
            <Banners />
            {needsSignIn ? <SignInPrompt /> : null}
            <QueueList />
            <Widgets placement="aboveEditor" />
            {/* An extension's dialog takes the composer's place, as in pi's terminal UI. */}
            <DialogPanel />
            <Composer key={threadId} hidden={asking} />
            <StatusRow
              end={
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <GitPill />
                  <PiUpdateIndicator />
                </div>
              }
            />
            <Widgets placement="belowEditor" />
          </div>
        </footer>
        {threadId && terminal ? (
          <Suspense
            fallback={
              <p role="status" className="p-3 text-sm">
                Loading terminal…
              </p>
            }
          >
            <TerminalDrawer key={terminal.id} threadId={threadId} session={terminal} />
          </Suspense>
        ) : null}
      </div>
      {changesOpen ? <DiffPanel key={threadId} /> : null}
    </div>
  );
}
