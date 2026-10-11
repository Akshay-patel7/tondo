import { PanelLeft, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { ShortcutCommand } from "../../shared/settings";
import { openTerminal, toggleSidebar, useHost } from "../connection";
import { toggleDiffPanel, useDiffPanel } from "../diffs/DiffPanel";
import { folderName } from "../format";
import { togglePalette } from "../palette/store";
import { isMac } from "../platform";
import { shortcutLabelFor } from "../shortcuts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** The window's title bar: the open thread and its project. */
export function Header({ sidebarHidden }: { sidebarHidden: boolean }) {
  const title = useHost((host) => host.thread?.title);
  const project = useHost((host) => host.thread?.project);
  const connection = useHost((host) => host.connection);
  const changesOpen = useDiffPanel((open) => open);
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
          <ShellButton
            label="Show sidebar"
            command="toggle-sidebar"
            disabled={connection !== "connected"}
            onClick={toggleSidebar}
          >
            <PanelLeft aria-hidden />
          </ShellButton>
          <ShellButton
            label="Search"
            command="palette"
            disabled={connection !== "connected"}
            onClick={togglePalette}
          >
            <Search aria-hidden />
          </ShellButton>
        </div>
      ) : null}
      {title === undefined ? null : <h1 className="min-w-0 truncate font-medium">{title}</h1>}
      {project === undefined ? null : (
        <span title={project} className="shrink-0 text-muted-foreground">
          {folderName(project)}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {project === undefined ? null : (
          <>
            <Button
              variant="quiet"
              size="xs"
              aria-pressed={changesOpen}
              onClick={toggleDiffPanel}
              className="app-no-drag"
            >
              Changes
            </Button>
            {/* openTerminal replaces a terminal that has exited with a new one. */}
            <Button
              variant="quiet"
              size="xs"
              onClick={() => openTerminal("shell")}
              className="app-no-drag"
            >
              Terminal
            </Button>
            <Button
              variant="quiet"
              size="xs"
              onClick={() => openTerminal("login")}
              className="app-no-drag"
            >
              Sign in to a provider
            </Button>
          </>
        )}
        {connection === "reconnecting" ? (
          <Badge variant="warning" role="status">
            Reconnecting…
          </Badge>
        ) : null}
      </div>
    </header>
  );
}

/**
 * An icon button in the window's chrome: the header or the sidebar's top. It
 * has no text, so `label` names it, and its tooltip shows the label with the
 * command's shortcut.
 */
export function ShellButton({
  label,
  command,
  disabled,
  onClick,
  children,
}: {
  label: string;
  command: ShortcutCommand;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={() => onClick()}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <ShortcutKeys command={command} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The command's shortcut, or nothing if you turned it off. The tooltip mounts
 * this as it opens, so a shortcut you changed in the settings shows at once.
 */
function ShortcutKeys({ command }: { command: ShortcutCommand }) {
  const keys = shortcutLabelFor(command, isMac);
  return keys === null ? null : <Kbd>{keys}</Kbd>;
}
