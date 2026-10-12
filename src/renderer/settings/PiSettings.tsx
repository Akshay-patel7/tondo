// The pi section: which pi Tondo runs, choosing another, and pi's own
// settings files.
import { CircleAlert, CircleCheck, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { PiDiscovery, SettingsFile } from "../../shared/protocol";
import {
  choosePiPath,
  requestPiConfigFiles,
  retryPi,
  revealFile,
  updateSettings,
  useHost,
} from "../connection";
import { folderName } from "../format";
import { isMac } from "../platform";
import { Button } from "../ui/button";
import { CardGroup, CardGroupRow, CardGroupRowText, CardGroupRowTitle } from "../ui/card-group";
import { Spinner } from "../ui/spinner";
import { Loading, SubHeading } from "./rows";

const REVEAL = isMac ? "Show in Finder" : "Show in folder";

export function PiSettings() {
  const env = useHost((host) => host.piEnv);
  const piPath = useHost((host) => host.settings?.piPath ?? null);
  const files = useHost((host) => host.piConfigFiles);
  const project = useHost((host) => host.thread?.project);
  const chooseId = useId();
  // The discovery on screen when you clicked Check again. The host's answer replaces it.
  const [checkedFrom, setCheckedFrom] = useState<PiDiscovery | null | undefined>(undefined);
  const checking = checkedFrom !== undefined && checkedFrom === env;

  // Files appear as pi writes them, and the project's file belongs to the thread on screen.
  useEffect(() => {
    requestPiConfigFiles();
    return useHost.subscribe((host, before) => {
      if (host.thread?.id !== before.thread?.id) requestPiConfigFiles();
    });
  }, []);

  return (
    <>
      <CardGroup>
        <div className="flex flex-col gap-4 p-4">
          <Discovery env={env} />
          {/* Under the text, past the 20px icon column and its 12px gap. */}
          <div className="flex flex-wrap gap-2 pl-8">
            <Button id={chooseId} variant="neutral" onClick={() => choosePiPath()}>
              <FolderOpen aria-hidden />
              Choose pi…
            </Button>
            {piPath === null ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  updateSettings({ piPath: null });
                  // This button goes away once the host has saved the change.
                  document.getElementById(chooseId)?.focus();
                }}
              >
                Use pi from PATH
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setCheckedFrom(env);
                retryPi();
              }}
            >
              {checking ? <Spinner size="sm" /> : <RefreshCw aria-hidden />}
              Check again
            </Button>
          </div>
        </div>
      </CardGroup>
      <SubHeading
        title="pi's settings files"
        description="pi reads its own settings from these. A project's file wins over your global one."
      />
      {files === null ? (
        <Loading>Looking for pi's settings files…</Loading>
      ) : (
        <CardGroup>
          {files.map((file) => (
            <ConfigFile key={file.path} file={file} project={project} />
          ))}
        </CardGroup>
      )}
    </>
  );
}

/** The pi Tondo found, or why it can't run one. */
function Discovery({ env }: { env: PiDiscovery | null }) {
  if (env === null) return <p className="pl-8 text-muted-foreground">Looking for pi…</p>;
  if (env.state === "found") {
    return (
      <Status
        icon={<CircleCheck aria-hidden className="text-success" />}
        title={`pi ${env.version}`}
      >
        <p className="text-faint-foreground">
          {env.source === "path" ? "Found on your PATH" : "At the path in Settings"}
        </p>
        <p className="font-mono break-all">{env.command}</p>
      </Status>
    );
  }
  const { problem, source } = env;
  switch (problem.kind) {
    case "too-old":
      return (
        <Status
          icon={<TriangleAlert aria-hidden className="text-warning" />}
          title={`pi ${problem.version} is too old`}
        >
          <p>Tondo needs pi {problem.required} or newer. Update pi, then check again.</p>
          <p className="font-mono break-all">{problem.command}</p>
        </Status>
      );
    case "not-found":
      return (
        <Status
          icon={<CircleAlert aria-hidden className="text-destructive" />}
          title={source === "path" ? "pi isn't on your PATH" : "pi isn't at the path you chose"}
        >
          <p className="font-mono break-all">{problem.detail}</p>
        </Status>
      );
    case "invalid":
      return (
        <Status
          icon={<CircleAlert aria-hidden className="text-destructive" />}
          title="Tondo can't run this pi"
        >
          <p className="font-mono break-all">{problem.detail}</p>
        </Status>
      );
  }
}

function Status({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
      <span className="mt-px flex [&_svg]:size-4 [&_svg]:shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{title}</p>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function ConfigFile({ file, project }: { file: SettingsFile; project: string | undefined }) {
  const pathId = useId();
  const { scope, path, exists } = file;
  // The host names the project's file "Project"; the sidebar names the project by its folder.
  const name =
    scope === "Project" && project !== undefined ? `Project · ${folderName(project)}` : scope;
  return (
    <CardGroupRow size="sm">
      <CardGroupRowText>
        <CardGroupRowTitle>{name}</CardGroupRowTitle>
        <p id={pathId} className="font-mono text-xs break-all text-faint-foreground">
          {path}
        </p>
      </CardGroupRowText>
      {exists ? (
        <Button variant="neutral" aria-describedby={pathId} onClick={() => revealFile(path)}>
          {REVEAL}
        </Button>
      ) : (
        <p className="text-xs text-faint-foreground">Doesn't exist yet</p>
      )}
    </CardGroupRow>
  );
}
