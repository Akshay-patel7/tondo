import { openProject, useHost } from "../connection";

/** What the window shows until you open a project. */
export function OpenProject() {
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="text-muted-foreground">Open a project folder to work with pi there.</p>
      <button
        type="button"
        disabled={!connected}
        onClick={openProject}
        className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Open project…
      </button>
    </main>
  );
}
