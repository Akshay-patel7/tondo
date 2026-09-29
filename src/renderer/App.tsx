import { useEffect } from "react";
import { Banners } from "./banners/Banners";
import { runAppCommand } from "./commands";
import { Composer } from "./composer/Composer";
import { QueueList } from "./composer/QueueList";
import { toggleSidebar, useHost } from "./connection";
import { DialogPanel } from "./extensionUi/DialogPanel";
import { useExtensionUi } from "./extensionUi/store";
import { StatusLine, Widgets } from "./extensionUi/Widgets";
import { folderName } from "./format";
import { CommandPalette } from "./palette/CommandPalette";
import { togglePalette, usePalette } from "./palette/store";
import { isMac } from "./platform";
import { NoThread } from "./project/NoThread";
import { TrustPrompt } from "./project/TrustPrompt";
import { appCommand, shortcutLabel } from "./shortcuts";
import { Sidebar } from "./sidebar/Sidebar";
import { useThreadKey } from "./thread/store";
import { Timeline } from "./timeline/Timeline";
import { Toasts } from "./toasts/Toasts";
import { SearchIcon, SidebarIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

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
      {paletteOpen ? <CommandPalette /> : null}
    </div>
  );
}

/** The window's title bar: the open thread and its project. */
function Header({ sidebarHidden }: { sidebarHidden: boolean }) {
  const title = useHost((host) => host.thread?.title);
  const project = useHost((host) => host.thread?.project);
  const connection = useHost((host) => host.connection);
  return (
    // The header gets its own compositing layer. In the page's layer its text
    // would need a raster tile as wide as the window, 3.9 MiB at 2x, redrawn
    // with every new title. With a thread open, the rest of the page's layer
    // is one solid color, which needs no tiles.
    <header
      className={`app-drag flex h-10 shrink-0 items-center gap-2 px-3 text-sm will-change-transform ${
        sidebarHidden && isMac ? "pl-20" : ""
      }`}
    >
      {sidebarHidden ? (
        <div className="flex shrink-0 gap-0.5">
          <IconButton
            label="Show sidebar"
            shortcut={shortcutLabel("B", isMac)}
            onClick={toggleSidebar}
          >
            <SidebarIcon />
          </IconButton>
          <IconButton label="Search" shortcut={shortcutLabel("K", isMac)} onClick={togglePalette}>
            <SearchIcon />
          </IconButton>
        </div>
      ) : null}
      {title === undefined ? null : <h1 className="min-w-0 truncate font-medium">{title}</h1>}
      {project === undefined ? null : (
        <span title={project} className="shrink-0 text-muted-foreground">
          {folderName(project)}
        </span>
      )}
      {connection === "reconnecting" ? (
        <span role="status" className="shrink-0 text-xs text-warning">
          Reconnecting…
        </span>
      ) : null}
    </header>
  );
}

function Body() {
  const project = useHost((host) => host.thread?.project);
  const askingTrust = useHost((host) => host.thread?.askingTrust ?? false);
  if (project === undefined) return <NoThread />;
  if (askingTrust) return <TrustPrompt project={project} />;
  return <Thread />;
}

function Thread() {
  const threadKey = useThreadKey((key) => key);
  const asking = useExtensionUi((ui) => ui.dialogs.length > 0);
  return (
    <>
      <main className="min-h-0 flex-1">
        <Timeline key={threadKey} />
      </main>
      <footer className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-3xl">
          <Banners />
          <QueueList />
          <Widgets placement="aboveEditor" />
          {/* An extension's dialog takes the composer's place, as in pi's terminal UI. */}
          <DialogPanel />
          <Composer hidden={asking} />
          <Widgets placement="belowEditor" />
          <StatusLine />
        </div>
      </footer>
    </>
  );
}
