import { Play, Settings2 } from "lucide-react";
import { runProjectScript, useGit, useHost } from "../connection";
import { openSettings } from "../settings/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SplitButton, SplitButtonMain, SplitButtonTrigger } from "../ui/split-button";

/** The first script runs in one click; the menu holds the rest and configuration. */
export function ProjectScripts() {
  const project = useHost(
    (host) => host.projects.find((item) => item.id === host.thread?.projectId)?.path,
  );
  const scripts = useHost((host) => (project ? host.settings?.projectScripts[project] : undefined));
  const disabled = useHost((host) => host.connection !== "connected" || !!host.thread?.askingTrust);
  const busy = useGit((git) => git.busy);
  const primary = scripts?.[0];
  return (
    <SplitButton className="app-no-drag">
      <SplitButtonMain
        disabled={disabled || busy}
        aria-label={primary ? `Run ${primary.name}` : "Configure project scripts"}
        title={primary ? `${primary.name}: ${primary.command}` : "Configure project scripts"}
        onClick={() => (primary ? runProjectScript(primary.id) : openSettings("scripts"))}
      >
        <Play aria-hidden />
        <span className="max-w-28 truncate @max-4xl:sr-only">{primary?.name ?? "Scripts"}</span>
      </SplitButtonMain>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SplitButtonTrigger disabled={disabled || busy} aria-label="Project scripts" />}
        />
        <DropdownMenuContent align="end">
          {scripts?.map((script) => (
            <DropdownMenuItem
              key={script.id}
              title={script.command}
              onClick={() => runProjectScript(script.id)}
            >
              <Play aria-hidden />
              <span className="max-w-56 truncate">{script.name}</span>
            </DropdownMenuItem>
          ))}
          {scripts?.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => openSettings("scripts")}>
            <Settings2 aria-hidden />
            Configure scripts…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SplitButton>
  );
}
