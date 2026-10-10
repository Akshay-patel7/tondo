// The pi section: which pi Tondo runs, choosing another, and pi's own
// settings files.
import { CircleAlert, CircleCheck, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { PiDiscovery } from "../../shared/protocol";
import {
  choosePiPath,
  requestPiConfigFiles,
  retryPi,
  revealFile,
  updateSettings,
  useHost,
} from "../connection";
import { isMac } from "../platform";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { GroupHeading, Loading, SectionHeading, SettingsGroup } from "./rows";

const REVEAL = isMac ? "Show in Finder" : "Show in folder";

export function PiSettings() {
  const env = useHost((host) => host.piEnv);
  const piPath = useHost((host) => host.settings?.piPath ?? null);
  const files = useHost((host) => host.piConfigFiles);
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
    <div className="flex flex-col gap-6">
      <SectionHeading title="pi" description="The pi program Tondo runs for each thread." />
      <SettingsGroup>
        <div className="flex flex-col gap-3.5 px-4 py-3.5">
          <Discovery env={env} />
          <div className="flex flex-wrap gap-2">
            <Button id={chooseId} variant="outline" size="sm" onClick={() => choosePiPath()}>
              <FolderOpen aria-hidden />
              Choose pi…
            </Button>
            {piPath === null ? null : (
              <Button
                variant="ghost"
                size="sm"
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
              size="sm"
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
      </SettingsGroup>
      <div className="flex flex-col gap-2">
        <GroupHeading
          title="pi's settings files"
          description="pi reads its own settings from these. A project's file wins over your global one."
        />
        {files === null ? (
          <Loading>Looking for pi's settings files…</Loading>
        ) : (
          <SettingsGroup>
            {files.map((file) => (
              <ConfigFile key={file.path} {...file} />
            ))}
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}

/** The pi Tondo found, or why it can't run one. */
function Discovery({ env }: { env: PiDiscovery | null }) {
  if (env === null) return <Loading>Looking for pi…</Loading>;
  if (env.state === "found") {
    return (
      <Status
        icon={<CircleCheck aria-hidden className="text-success" />}
        title={`pi ${env.version}`}
      >
        <p>{env.source === "path" ? "Found on your PATH" : "Chosen in Settings"}</p>
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
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex shrink-0 [&_svg]:size-4">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function ConfigFile({ scope, path, exists }: { scope: string; path: string; exists: boolean }) {
  const pathId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <p className="text-sm font-medium">{scope}</p>
        <p id={pathId} className="font-mono text-xs break-all text-muted-foreground">
          {path}
        </p>
      </div>
      {exists ? (
        <Button
          variant="outline"
          size="xs"
          aria-describedby={pathId}
          onClick={() => revealFile(path)}
        >
          <FolderOpen aria-hidden />
          {REVEAL}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Doesn't exist yet</p>
      )}
    </div>
  );
}
