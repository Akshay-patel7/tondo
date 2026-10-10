import { CircleAlert, CircleCheck, FolderPlus, MessageSquarePlus, Plus } from "lucide-react";
import type { PiProblem } from "../../shared/protocol";
import { addProject, choosePiPath, newThread, useHost } from "../connection";
import { folderName } from "../format";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";

/** What the window shows when no thread is open: a welcome until you add a project. */
export function NoThread() {
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
  const project = useHost((host) => host.projects[0]);
  // The welcome is one layer of its own, sized to it, rather than part of the
  // window-wide tiles. Larger or more layers here leave the GPU process holding
  // more raster memory when the first thread opens.
  return (
    <main className="flex min-h-0 flex-1">
      <Empty>
        <div className="flex w-full max-w-sm flex-col items-center gap-6 will-change-transform">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {project ? <MessageSquarePlus /> : <FolderPlus />}
            </EmptyMedia>
            <EmptyTitle>
              <h1>{project ? "No thread open" : "Welcome to Tondo"}</h1>
            </EmptyTitle>
            <EmptyDescription>
              {project
                ? "Open a thread from the sidebar, or start a new one."
                : "Add a project folder to work with pi there."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              disabled={!connected}
              onClick={project ? () => newThread(project.id) : addProject}
            >
              <Plus data-icon="inline-start" aria-hidden />
              {project ? `New thread in ${folderName(project.path)}` : "Add project…"}
            </Button>
            {project ? null : <PiStatus connected={connected} />}
          </EmptyContent>
        </div>
      </Empty>
    </main>
  );
}

function missing(problem: PiProblem): string {
  switch (problem.kind) {
    case "not-found":
      return "pi isn't installed.";
    case "too-old":
      return `Found pi ${problem.version}, and Tondo needs ${problem.required} or newer.`;
    case "invalid":
      return "Tondo can't run the pi it found.";
  }
}

/** Which pi Tondo would run, or why it has none, before any thread starts one. */
function PiStatus({ connected }: { connected: boolean }) {
  const pi = useHost((host) => host.piEnv);
  const settingsError = useHost((host) => host.settingsError);
  // The line keeps its height while the host looks for pi, so the welcome doesn't shift.
  if (pi === null) return <div className="h-6" />;
  if (pi.state === "found")
    return (
      <p className="flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheck aria-hidden className="size-3.5 text-success" />
        Found pi {pi.version} {pi.source === "path" ? "on your PATH" : "at the path in Settings"}.
      </p>
    );
  return (
    <>
      <div className="flex min-h-6 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <CircleAlert aria-hidden className="size-3.5 text-warning" />
        <span>{missing(pi.problem)}</span>
        <Button variant="outline" size="xs" disabled={!connected} onClick={choosePiPath}>
          Choose pi…
        </Button>
      </div>
      {settingsError ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Tondo didn't save that change</AlertTitle>
          <AlertDescription className="break-words">{settingsError}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
