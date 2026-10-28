import {
  ArrowLeft,
  CodeXml,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  PanelLeft,
  Search,
  Terminal,
} from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import type { ShortcutCommand } from "../../shared/settings";
import { ideLabel } from "../../shared/ide";
import {
  listCheckpoints,
  openTerminal,
  openThreadIde,
  requestPiAccounts,
  useCheckpoints,
  useGit,
  useHost,
  usePiUpdates,
} from "../connection";
import { toggleDiffPanel, useDiffPanel } from "../diffs/store";
import { folderName } from "../format";
import { GitActions } from "../git/GitActions";
import { ProjectScripts } from "./ProjectScripts";
import { togglePalette } from "../palette/store";
import { isMac } from "../platform";
import { closeSettings, useSettingsPage } from "../settings/store";
import { shortcutLabelFor } from "../shortcuts";
import { toggleSidebarShown } from "../sidebar/layout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * The window's title bar. With a thread open it names the thread, its
 * folder and branch, and holds the thread's controls. Over the settings page
 * it holds Back. On the home page it's empty.
 */
export function Header({ sidebarHidden }: { sidebarHidden: boolean }) {
  const settingsOpen = useSettingsPage((page) => page.open);
  const project = useHost((host) => host.thread?.project);
  const connection = useHost((host) => host.connection);
  const mode = settingsOpen ? "settings" : project === undefined ? "home" : "thread";
  return (
    // The header gets its own compositing layer. In the page's layer its text
    // would need a raster tile as wide as the window, 3.9 MiB at 2x, redrawn
    // with every new title. With a thread open, the rest of the page's layer
    // is one solid color, which needs no tiles.
    <header
      className={`app-drag @container flex shrink-0 items-center border-b border-border pr-3 text-sm will-change-transform ${mode === "thread" ? "h-14" : "h-11"} ${
        sidebarHidden && isMac ? "pl-20" : mode === "settings" ? "pl-4" : "pl-6"
      } ${mode === "settings" ? "gap-2" : "gap-3"}`}
    >
      {sidebarHidden ? (
        <div className="flex shrink-0 gap-0.5">
          <ShellButton
            label="Show sidebar"
            command="toggle-sidebar"
            disabled={connection !== "connected"}
            onClick={toggleSidebarShown}
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
      {mode === "settings" ? <SettingsHeader /> : null}
      {mode === "thread" && project !== undefined ? <ThreadHeader project={project} /> : null}
      {connection === "reconnecting" ? (
        <Badge variant="warning" role="status" className={mode === "thread" ? "" : "ml-auto"}>
          Reconnecting…
        </Badge>
      ) : null}
    </header>
  );
}

/** Back, the page's name, and how the page saves. Back closes the page as Escape does. */
function SettingsHeader() {
  return (
    <>
      <Button variant="ghost" onClick={leaveSettings} className="app-no-drag">
        <ArrowLeft aria-hidden />
        Back
      </Button>
      <HeaderDivider />
      <h1 className="ml-1 font-medium">Settings</h1>
      <p className="ml-auto text-2xs text-faint-foreground">
        Changes save as you make them · Esc to go back
      </p>
    </>
  );
}

// Leaving a number field saves the number typed in it, so the field loses
// focus first, as it does when Escape closes the page (SettingsPage.tsx).
function leaveSettings(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  closeSettings();
}

function ThreadHeader({ project }: { project: string }) {
  const threadId = useHost((host) => host.thread?.id);
  const title = useHost((host) => host.thread?.title);
  // pi has no model you have credentials for. Until pi is ready Tondo can't
  // tell, so a thread you're signed in to doesn't flash sign-in as it starts.
  const needsSignIn = useHost((host) => {
    const pi = host.thread?.pi;
    return pi?.state === "ready" && !pi.session.signedIn;
  });
  // pi's auth.json saves no sign-in either. That's unknown until the host has
  // listed them, so sign-in waits for the list, and one Tondo couldn't read
  // counts as empty. They're read again each time pi starts without a model,
  // since you may have signed in or out in pi's terminal meanwhile.
  const noneSaved = useHost((host) => host.piAccounts?.accounts.length === 0);
  useEffect(() => {
    if (needsSignIn) requestPiAccounts();
  }, [needsSignIn]);
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title === undefined ? null : (
          <h1 title={title} className="truncate font-medium">
            {title}
          </h1>
        )}
        <Breadcrumb project={project} />
      </div>
      {/* Shorten controls before they crowd the thread name. */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Once a provider is set up, Settings > Accounts signs in to another. */}
        {needsSignIn && noneSaved ? (
          <Button variant="ghost" onClick={() => openTerminal("login")} className="app-no-drag">
            {/* A narrow header, as at 200% zoom, shows "Sign in". Screen readers hear it all. */}
            Sign in<span className="@max-md:sr-only"> to a provider</span>
          </Button>
        ) : null}
        <ProjectScripts key={`scripts-${threadId}`} />
        <IdeButton project={project} />
        {/* openTerminal replaces a terminal that has exited with a new one. */}
        <Button
          variant="ghost"
          title="Terminal"
          onClick={() => openTerminal("shell")}
          className="app-no-drag"
        >
          <Terminal aria-hidden />
          <span className="@max-4xl:sr-only">Terminal</span>
        </Button>
        <ChangesButton />
        {/* Keyed by thread, so a dialog left open belongs to the thread that opened it. */}
        <GitActions key={threadId} />
      </div>
    </>
  );
}

/** The title has its own line; each checkout detail truncates within the line below. */
function Breadcrumb({ project }: { project: string }) {
  const activity = useGit((git) => git.agentCheckout);
  const branch = useGit((git) => {
    if (git.agentCheckout) return git.agentCheckout.branch ?? "Detached HEAD";
    return git.status?.root ? (git.status.branch ?? "Detached HEAD") : null;
  });
  const root = activity?.root ?? project;
  return (
    <div
      role="group"
      aria-label={activity ? "Agent checkout" : "Thread checkout"}
      title={
        activity
          ? `Agent activity in ${root}. Open in IDE and project scripts use this folder. Terminal, Changes and Git actions still use ${project}.`
          : undefined
      }
      className="flex min-w-0 items-center gap-2 text-xs text-faint-foreground"
    >
      {activity ? <FolderGit2 aria-hidden className="size-3 shrink-0" /> : null}
      <span title={root} className="min-w-0 max-w-40 shrink truncate">
        {folderName(root)}
      </span>
      {branch === null ? null : (
        <span
          title={branch}
          className="flex min-w-0 max-w-fit flex-1 items-center gap-1 font-mono text-muted-foreground"
        >
          <GitBranch aria-hidden className="size-3 shrink-0" />
          <span className="truncate">
            <span className="sr-only">Branch </span>
            {branch}
          </span>
        </span>
      )}
    </div>
  );
}

function IdeButton({ project }: { project: string }) {
  const command = useHost((host) => host.settings?.ideCommand ?? "code");
  const connected = useHost((host) => host.connection === "connected");
  const busy = useGit((git) => git.busy);
  const label = `Open in ${ideLabel(command)}`;
  const root = useGit((git) => git.agentCheckout?.root) ?? project;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            disabled={!connected || busy}
            onClick={openThreadIde}
            className="app-no-drag"
          />
        }
      >
        <CodeXml aria-hidden />
        <span className="@max-4xl:sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <br />
        {root}
      </TooltipContent>
    </Tooltip>
  );
}

/** Toggles the panel. The counts always describe the latest turn, even while browsing an older one. */
function ChangesButton() {
  const changesOpen = useDiffPanel((open) => open);
  const threadId = useHost((host) => host.thread?.id);
  const connected = useHost((host) => host.connection === "connected");
  const latest = useCheckpoints((state) => state.turns.at(-1));
  const statsId = useId();
  const updating = usePiUpdates((updates) => updates.updating);
  const stats = latest?.state === "ready" ? latest.stats : undefined;
  const counts = stats?.error === null ? stats : null;
  useEffect(() => {
    if (threadId && connected) listCheckpoints();
  }, [threadId, connected]);
  return (
    <Button
      variant="neutral"
      aria-pressed={changesOpen}
      disabled={updating}
      aria-describedby={stats ? statsId : undefined}
      title={stats?.error ? `Couldn't count the latest turn's changes: ${stats.error}` : "Changes"}
      onClick={toggleDiffPanel}
      className="app-no-drag"
    >
      <GitCompareArrows aria-hidden />
      <span className="@max-4xl:sr-only">Changes</span>
      {/* The counts describe the button rather than name it, so it stays "Changes". */}
      {counts ? (
        <span aria-hidden className="font-mono text-2xs">
          <span className="text-addition">+{counts.added}</span>{" "}
          <span className="text-deletion">−{counts.removed}</span>
        </span>
      ) : null}
      {stats ? (
        <span id={statsId} hidden>
          {counts
            ? `Latest turn: ${counts.added} added, ${counts.removed} removed`
            : `Couldn't count the latest turn's changes: ${stats.error}`}
        </span>
      ) : null}
    </Button>
  );
}

export function HeaderDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-input" />;
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
