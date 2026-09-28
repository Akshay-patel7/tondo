import { Banners } from "./banners/Banners";
import { Composer } from "./composer/Composer";
import { QueueList } from "./composer/QueueList";
import { openProject, useHost } from "./connection";
import { folderName } from "./format";
import { OpenProject } from "./project/OpenProject";
import { TrustPrompt } from "./project/TrustPrompt";
import { useThreadKey } from "./thread/store";
import { Timeline } from "./timeline/Timeline";

export function App() {
  return (
    <div className="flex h-screen flex-col bg-background font-sans text-foreground">
      <Header />
      <Body />
    </div>
  );
}

/** The window's title bar: the project, which you click to open another one. */
function Header() {
  const project = useHost((host) => host.workspace.project);
  const connection = useHost((host) => host.connection);
  return (
    <header className="app-drag flex h-10 shrink-0 items-center justify-center gap-2 text-sm">
      {project === null ? (
        <span className="font-medium">Tondo</span>
      ) : (
        <button
          type="button"
          onClick={openProject}
          title={`${project}\nClick to open another project`}
          className="app-no-drag flex items-center gap-1 rounded-control px-2 py-0.5 font-medium hover:bg-accent hover:text-accent-foreground"
        >
          {folderName(project)}
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 text-muted-foreground">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      )}
      {connection === "reconnecting" ? (
        <span role="status" className="text-xs text-warning">
          Reconnecting…
        </span>
      ) : null}
    </header>
  );
}

function Body() {
  const project = useHost((host) => host.workspace.project);
  const askingTrust = useHost((host) => host.workspace.askingTrust);
  if (project === null) return <OpenProject />;
  if (askingTrust) return <TrustPrompt project={project} />;
  return <Thread />;
}

function Thread() {
  const threadKey = useThreadKey((key) => key);
  return (
    <>
      <main className="min-h-0 flex-1">
        <Timeline key={threadKey} />
      </main>
      <footer className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-3xl">
          <Banners />
          <QueueList />
          <Composer />
        </div>
      </footer>
    </>
  );
}
