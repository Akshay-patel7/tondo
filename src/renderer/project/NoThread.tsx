import { CircleAlert, Plus } from "lucide-react";
import { addProject, revealFile, useHost } from "../connection";
import { isMac } from "../platform";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

import { Home } from "./Home";

export function NoThread() {
  const hasProjects = useHost((host) => host.projects.length > 0);
  const connected = useHost((host) => host.connection === "connected");
  return hasProjects ? (
    <Home />
  ) : (
    <main className="flex min-h-0 flex-1">
      <Empty>
        <div className="flex w-full max-w-sm flex-col items-center gap-4 will-change-transform">
          <EmptyHeader>
            <EmptyTitle>
              <h1>Add a project</h1>
            </EmptyTitle>
            <EmptyDescription>Choose a folder to start working with pi.</EmptyDescription>
          </EmptyHeader>
          <Button disabled={!connected} onClick={addProject}>
            <Plus aria-hidden />
            Add project…
          </Button>
          <SettingsAlerts />
        </div>
      </Empty>
    </main>
  );
}

function SettingsAlerts() {
  const settingsError = useHost((host) => host.settingsError);
  const settingsFileError = useHost((host) => host.settingsFileError);
  const settingsFile = useHost((host) => host.settingsFilePath);
  if (settingsFileError === null && settingsError === null) return null;
  return (
    <div className="flex flex-col gap-2">
      {settingsFileError === null ? null : (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Tondo can't use its settings file</AlertTitle>
          <AlertDescription className="break-words">
            {settingsFileError}{" "}
            {settingsFile === null ? null : (
              <Button variant="link" size="xs" onClick={() => revealFile(settingsFile)}>
                {isMac ? "Show in Finder" : "Show in folder"}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {settingsError === null ? null : (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Tondo didn't save that change</AlertTitle>
          <AlertDescription className="break-words">{settingsError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
