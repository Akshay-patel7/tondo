import { addProject, newThread, useHost } from "../connection";
import { folderName } from "../format";

/** What the window shows when no thread is open. */
export function NoThread() {
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
  const project = useHost((host) => host.projects[0]);
  // Rasterize the prompt and button separately, not into window-wide tiles.
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="text-muted-foreground will-change-transform">
        {project
          ? "Open a thread from the sidebar, or start a new one."
          : "Add a project folder to work with pi there."}
      </p>
      <button
        type="button"
        disabled={!connected}
        onClick={project ? () => newThread(project.id) : addProject}
        className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground will-change-transform hover:bg-primary/90 disabled:opacity-50"
      >
        {project ? `New thread in ${folderName(project.path)}` : "Add project…"}
      </button>
    </main>
  );
}
