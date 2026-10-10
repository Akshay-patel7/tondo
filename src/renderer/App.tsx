import { lazy, Suspense, useEffect } from "react";
import { Banners } from "./banners/Banners";
import { BranchToolbar } from "./git/BranchToolbar";
import { runAppCommand } from "./commands";
import { Composer } from "./composer/Composer";
import { QueueList } from "./composer/QueueList";
import { useHost } from "./connection";
import { useTerminals } from "./terminal/store";
import { DialogPanel } from "./extensionUi/DialogPanel";
import { DiffPanel, useDiffPanel } from "./diffs/DiffPanel";
import { useExtensionUi } from "./extensionUi/store";
import { StatusLine, Widgets } from "./extensionUi/Widgets";
import { PiSetup } from "./onboarding/PiSetup";
import { SignInPrompt } from "./onboarding/SignInPrompt";
import { CommandPalette } from "./palette/CommandPalette";
import { usePalette } from "./palette/store";
import { isMac } from "./platform";
import { NoThread } from "./project/NoThread";
import { TrustPrompt } from "./project/TrustPrompt";
import { SettingsPage } from "./settings/SettingsPage";
import { useSettingsPage } from "./settings/store";
import { Sheets } from "./sheets/Sheets";
import { appCommand } from "./shortcuts";
import { Sidebar } from "./sidebar/Sidebar";
import { Header } from "./shell/Header";
import { useThreadKey } from "./thread/store";
import { Timeline } from "./timeline/Timeline";
import { Toasts } from "./toasts/Toasts";

const TerminalDrawer = lazy(() => import("./terminal/TerminalDrawer"));

export function App() {
  const sidebarHidden = useHost((host) => host.sidebarHidden);
  const paletteOpen = usePalette((open) => open);
  const title = useExtensionUi((ui) => ui.title);

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
      runAppCommand(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-background font-sans text-foreground">
      {sidebarHidden ? null : <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header sidebarHidden={sidebarHidden} />
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
  if (settingsOpen) return <SettingsPage />;
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
  const needsSignIn = useHost((host) => {
    const pi = host.thread?.pi;
    return pi?.state === "ready" && !pi.session.signedIn;
  });
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1">
          <Timeline key={threadKey} />
        </main>
        <footer className="shrink-0 px-4 pb-4">
          <div className="mx-auto max-w-3xl">
            <Banners />
            {needsSignIn ? <SignInPrompt /> : null}
            <QueueList />
            <Widgets placement="aboveEditor" />
            {/* An extension's dialog takes the composer's place, as in pi's terminal UI. */}
            <DialogPanel />
            <Composer key={threadId} hidden={asking} />
            <Widgets placement="belowEditor" />
            <StatusLine />
            <BranchToolbar key={`git:${threadId}`} />
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
