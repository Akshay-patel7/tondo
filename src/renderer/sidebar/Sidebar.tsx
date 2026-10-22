// The sidebar lists your projects and, under each, its threads: the pinned
// ones first, then the newest. The layout follows T3 Code's
// (apps/web/src/components/Sidebar.tsx). T3's rows each take a Tab stop;
// here the rows share one, and the arrow keys, Home and End move between them.
import {
  CircleAlert,
  Ellipsis,
  Folder,
  GitBranch,
  Mail,
  PanelLeft,
  Pen,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { SidebarProject, SidebarThread, ThreadActivity } from "../../shared/protocol";
import type { ShortcutCommand } from "../../shared/settings";
import { checkShortcuts, chordLabel } from "../../shared/shortcuts";
import { newThreadHere } from "../commands";
import {
  addProject,
  deleteThread,
  markThreadUnread,
  newThread,
  openThread,
  pinThread,
  removeProject,
  renameThread,
  setCollapsed,
  useHost,
} from "../connection";
import { folderName, formatAge } from "../format";
import { togglePalette } from "../palette/store";
import { isMac } from "../platform";
import { openSettings, useSettingsPage } from "../settings/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { PanelResizeHandle } from "../ui/panel-resize";
import { StatusDot, StatusRing, TondoMark } from "../ui/status";
import { ThreadTooltipContent } from "../ui/thread-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { toggleSidebarShown, usePanelSize } from "./layout";
import { listedThreads, MORE_SIZE, PAGE_SIZE, runningCount } from "./model";
import { endRename, startRename, useFocusedRow, useRenaming } from "./store";

// The list, each row with its own buttons, and the button in each row that
// takes focus: a project's header, a thread, or "Show N more".
const LIST = "[data-sidebar-list]";
const ITEM = "[data-sidebar-item]";
const ROW = "[data-sidebar-row]";

/** The time, updated each minute, so the threads' ages stay current. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * How `command`'s shortcut reads beside a button, or null if you turned it
 * off. It's derived from the settings the page holds, so a shortcut you
 * change in the settings reads right away.
 */
function useShortcutHint(command: ShortcutCommand): string | null {
  const shortcuts = useHost((host) => host.settings?.shortcuts);
  const chord = checkShortcuts(shortcuts ?? {}).usable[command];
  return chord === null ? null : chordLabel(chord, isMac);
}

/**
 * The tabIndex of the row `key`: 0 for the list's one Tab stop, -1 for the
 * rest. Until you focus a row, the stop is the row `fallback` marks.
 */
function useTabStop(key: string, fallback: boolean): 0 | -1 {
  const stop = useFocusedRow((row) => (row === null ? fallback : row === key));
  useEffect(
    () => () => {
      if (useFocusedRow.getState() === key) useFocusedRow.setState(null, true);
    },
    [key],
  );
  return stop ? 0 : -1;
}

function focusRow(key: string): void {
  useFocusedRow.setState(key, true);
}

function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const { key, target, currentTarget } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  // Keys from a row's menu bubble through here too, though the menu isn't in the list.
  if (event.defaultPrevented || !(target instanceof HTMLButtonElement)) return;
  if (!currentTarget.contains(target)) return;
  event.preventDefault();
  const rows = [...currentTarget.querySelectorAll<HTMLElement>(ROW)];
  const at = rows.findIndex((row) => row.closest(ITEM) === target.closest(ITEM));
  if (key === "Home") rows[0]?.focus();
  else if (key === "End") rows.at(-1)?.focus();
  else rows[at + (key === "ArrowDown" ? 1 : -1)]?.focus();
}

/**
 * Shift+F10 and the context menu key open the row's menu below it, as a
 * right-click there would. Chromium sends no contextmenu event for them on
 * macOS, and none for a key the page handles elsewhere.
 */
function openContextMenu(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const { left, bottom } = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: left + 8,
      clientY: bottom,
    }),
  );
}

/** The first row after `element` in the list, or else the last row before it. */
function rowNear(element: HTMLElement): HTMLElement | undefined {
  const rows = [...(element.closest(LIST)?.querySelectorAll<HTMLElement>(ROW) ?? [])].filter(
    (row) => !element.contains(row),
  );
  return (
    rows.find((row) => element.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) ??
    rows.at(-1)
  );
}

/**
 * When the element leaves the page while it holds focus, such as a thread you
 * deleted from its menu, focus moves to the row next to it, not to the page.
 * The host can drop the row before the menu has finished closing, and the
 * menu, which unmounts with it, isn't inside it.
 */
function usePassFocusOn(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      const active = document.activeElement;
      if (!element || (!element.contains(active) && !active?.closest("[role=menu]"))) return;
      const next = rowNear(element);
      queueMicrotask(() => {
        // StrictMode unmounts and remounts in development, leaving the element in place.
        if (!element.isConnected && document.activeElement === document.body) next?.focus();
      });
    };
  }, [ref]);
}

interface Removal {
  readonly project: SidebarProject;
  /** The project's header, where focus goes back if you keep the project. */
  readonly header: RefObject<HTMLButtonElement | null>;
}

/**
 * An icon button in the sidebar's chrome: Hide sidebar in the top row, the
 * Projects row's +, and Settings in the footer. It has no text, so `label`
 * names it, and its tooltip shows the label with the command's shortcut.
 */
function ChromeButton({
  label,
  command,
  size = "icon",
  side,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  command: ShortcutCommand;
  size?: "icon" | "icon-sm";
  side: "top" | "bottom";
  /** Whether the button shows what it opens, as Settings does while the page is open. */
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const keys = useShortcutHint(command);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="faint-ghost"
            size={size}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onClick()}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {keys === null ? null : <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The footer's account of pi: the one Tondo found and how many threads it's
 * busy in, or that there's no pi to run. Nothing until the host has looked.
 */
function PiState() {
  const pi = useHost((host) => host.piEnv);
  const running = useHost((host) => runningCount(host.projects));
  if (pi === null) return null;
  if (pi.state === "missing") {
    return (
      <span className="flex items-center gap-2">
        <StatusDot tone="warning" />
        <span>pi not found</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusDot tone="success" />
      <span className="truncate">pi {pi.version}</span>
      <span className="shrink-0 text-faint-foreground">
        {running === 0 ? "· idle" : `· ${running} running`}
      </span>
    </span>
  );
}

export function Sidebar() {
  const size = usePanelSize("sidebar");
  const projects = useHost((host) => host.projects);
  const openId = useHost((host) => host.thread?.id);
  // Home: projects, but no thread on screen. The page there is a new thread,
  // so the New thread button shows pressed.
  const home = useHost((host) => host.thread === null) && projects.length > 0;
  const settingsOpen = useSettingsPage((page) => page.open);
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
  const newThreadKeys = useShortcutHint("new-thread");
  const searchKeys = useShortcutHint("palette");
  const now = useMinute();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deletion = useHost((host) => host.deletion);
  const confirmingDeletion = useHost((host) => host.confirmingDeletion);
  // Until you focus a row, Tab reaches the open thread's, or the first project's.
  const openListed = projects.some(
    (project) => !project.collapsed && project.threads.some((t) => t.id === openId),
  );
  const askToRemove = (asked: Removal) => {
    setRemoval(asked);
    setConfirming(true);
  };
  return (
    // The sidebar and its parts get compositing layers of their own, to save
    // GPU memory. The sidebar's layer and its border's each paint one solid
    // color, and a solid layer needs no raster tiles. The controls, the list
    // and the footer get layers sized to what they show, so a change there
    // redraws a small tile, not one the height of the window. Painted into
    // the page's layer instead, the sidebar would turn each full-width tile
    // row beside it from one solid color into a raster tile, about 15 MiB at 2x.
    <nav
      aria-label="Threads"
      className="relative flex min-w-0 shrink-0 flex-col border-r border-transparent bg-sidebar will-change-transform"
      style={{ width: size.width }}
    >
      <PanelResizeHandle label="Resize sidebar" edge="right" {...size} />
      <div
        aria-hidden
        className="absolute inset-y-0 -right-px w-px bg-border will-change-transform"
      />
      <div className="shrink-0 will-change-transform">
        {/* The window's drag region. On macOS the traffic lights sit at its left. */}
        <div
          className={`app-drag flex h-11 items-center justify-end pr-2 ${isMac ? "pl-16" : "pl-2"}`}
        >
          <ChromeButton
            label="Hide sidebar"
            command="toggle-sidebar"
            side="bottom"
            disabled={!connected}
            onClick={toggleSidebarShown}
          >
            <PanelLeft aria-hidden />
          </ChromeButton>
        </div>
        <div className="flex items-center gap-2 px-4 pt-1 pb-3">
          <TondoMark />
          <span className="text-message leading-4.5 font-semibold tracking-[-0.01em]">Tondo</span>
        </div>
        <div className="flex flex-col gap-1 px-2 pb-3">
          {/* Without a project there's nothing to start a thread in: Welcome adds one. */}
          <Button
            variant="raised"
            size="lg"
            className="w-full justify-start"
            aria-pressed={home}
            disabled={!connected || projects.length === 0}
            onClick={newThreadHere}
          >
            <SquarePen aria-hidden />
            New thread
            {newThreadKeys === null ? null : (
              <Kbd variant="hint" className="ml-auto">
                {newThreadKeys}
              </Kbd>
            )}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full justify-start"
            disabled={!connected}
            onClick={togglePalette}
          >
            <Search aria-hidden />
            Search
            {searchKeys === null ? null : (
              <Kbd variant="hint" className="ml-auto">
                {searchKeys}
              </Kbd>
            )}
          </Button>
        </div>
        {/* 24px, so with the list's top padding the first row sits 28px below the label's top. */}
        <div className="flex h-6 items-center justify-between pr-2 pl-4">
          <h2 className="text-2xs font-medium text-faint-foreground">Projects</h2>
          <ChromeButton
            label="Add project"
            command="add-project"
            size="icon-sm"
            side="bottom"
            disabled={!connected}
            onClick={addProject}
          >
            <Plus aria-hidden />
          </ChromeButton>
        </div>
      </div>
      {/* The top padding and scroll padding keep a focused row's ring in view. */}
      <div className="min-h-0 flex-1 scroll-py-1 overflow-y-auto px-2 pt-1 pb-3">
        <div data-sidebar-list="" className="will-change-transform" onKeyDown={moveFocus}>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-faint-foreground">No projects yet.</p>
          ) : null}
          {projects.map((project, index) => (
            <ProjectGroup
              key={project.id}
              project={project}
              openId={openId}
              now={now}
              tabFallback={index === 0 && !openListed}
              onRemove={askToRemove}
              onDelete={(asked) => useHost.setState({ deletion: asked, confirmingDeletion: true })}
            />
          ))}
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border pr-2 pl-4 text-xs text-muted-foreground will-change-transform">
        <PiState />
        <div className="ml-auto">
          <ChromeButton
            label="Settings"
            command="settings"
            side="top"
            pressed={settingsOpen}
            disabled={!connected}
            onClick={() => openSettings()}
          >
            <Settings aria-hidden />
          </ChromeButton>
        </div>
      </div>
      {removal === null ? null : (
        <RemoveProject removal={removal} open={confirming} onOpenChange={setConfirming} />
      )}
      {deletion === null ? null : (
        <DeleteThread
          thread={deletion}
          open={confirmingDeletion}
          onOpenChange={(open) => useHost.setState({ confirmingDeletion: open })}
        />
      )}
    </nav>
  );
}

function ProjectGroup({
  project,
  openId,
  now,
  tabFallback,
  onRemove,
  onDelete,
}: {
  project: SidebarProject;
  openId: string | undefined;
  now: number;
  /** Whether the header is the Tab stop until you focus a row. */
  tabFallback: boolean;
  onRemove: (removal: Removal) => void;
  onDelete: (thread: SidebarThread) => void;
}) {
  const [count, setCount] = useState(PAGE_SIZE);
  const name = folderName(project.path);
  const { listed, more } = listedThreads(project.threads, count, openId);
  const headerKey = `project:${project.id}`;
  const moreKey = `more:${project.id}`;
  const tabIndex = useTabStop(headerKey, tabFallback);
  const moreTabIndex = useTabStop(moreKey, false);
  const section = useRef<HTMLElement>(null);
  const header = useRef<HTMLButtonElement>(null);
  const threadList = useRef<HTMLUListElement>(null);
  const focusAfterMore = useRef<number | null>(null);
  usePassFocusOn(section);
  // "Show N more" goes away once it lists the last threads. If it had focus,
  // the first thread it added gets it.
  useLayoutEffect(() => {
    const index = focusAfterMore.current;
    if (index === null) return;
    focusAfterMore.current = null;
    threadList.current?.querySelectorAll<HTMLElement>(ROW)[index]?.focus();
  });
  const items = (
    <>
      <DropdownMenuItem onClick={() => newThread(project.id)}>
        <SquarePen aria-hidden />
        New thread
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => onRemove({ project, header })}>
        <Trash2 aria-hidden />
        Remove project…
      </DropdownMenuItem>
    </>
  );

  return (
    <section ref={section} aria-label={name} className="mt-2 first:mt-0">
      <ContextMenu>
        <ContextMenuTrigger
          data-sidebar-item=""
          onFocus={() => focusRow(headerKey)}
          render={
            <div className="group relative flex h-7 items-center rounded-control pr-1 hover:bg-accent data-popup-open:bg-accent has-data-popup-open:bg-accent" />
          }
        >
          {/* No chevron: aria-expanded says whether the threads show, and a click flips it. */}
          <button
            ref={header}
            type="button"
            data-sidebar-row=""
            tabIndex={tabIndex}
            aria-expanded={!project.collapsed}
            title={project.path}
            onClick={() => setCollapsed(project.id, !project.collapsed)}
            onKeyDown={openContextMenu}
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left text-sm font-medium outline-none focus-visible:focus-ring"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-faint-foreground" />
            <span className="truncate">{name}</span>
          </button>
          {/* It sits over the buttons' space while they're faded out, and
              goes when they show. It's outside the header, which the folder
              name alone names. */}
          {project.threads.length === 0 ? (
            <span className="absolute right-2 text-2xs text-faint-foreground group-focus-within:invisible group-hover:invisible group-has-data-popup-open:invisible group-data-popup-open:invisible">
              No threads
            </span>
          ) : null}
          {/* The project's buttons fade out rather than hide: a hidden button
              can't take focus, so Escape in its menu would leave focus on the
              page. They show on hover and while focus is in the row. */}
          <div className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`New thread in ${name}`}
                    tabIndex={tabIndex}
                    onClick={() => newThread(project.id)}
                  />
                }
              >
                <Plus aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">New thread in {name}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-popup-open:opacity-100 has-data-popup-open:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label="Project actions"
                tabIndex={tabIndex}
              >
                <Ellipsis aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{items}</DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`${name} actions`}>{items}</ContextMenuContent>
      </ContextMenu>
      {project.collapsed ? null : (
        <ul ref={threadList} className="mt-0.5 flex flex-col gap-0.5">
          {listed.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              open={thread.id === openId}
              now={now}
              onDelete={onDelete}
            />
          ))}
          {more > 0 ? (
            <li data-sidebar-item="" onFocus={() => focusRow(moreKey)}>
              <Button
                variant="ghost"
                size="sm"
                data-sidebar-row=""
                tabIndex={moreTabIndex}
                onClick={(event) => {
                  if (more <= MORE_SIZE && event.currentTarget === document.activeElement) {
                    focusAfterMore.current = count;
                  }
                  setCount(count + MORE_SIZE);
                }}
                className="ml-5"
              >
                Show {Math.min(more, MORE_SIZE)} more
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function RemoveProject({
  removal,
  open,
  onOpenChange,
}: {
  removal: Removal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { project, header } = removal;
  const name = folderName(project.path);
  // After a removal, focus goes to the row next to the project, which stays.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup
        finalFocus={() => {
          const target = returnTo.current ?? header.current;
          returnTo.current = null;
          return target ?? true;
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Tondo forgets the project's pins, drafts and turn checkpoints. pi's session files stay
            on disk.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              const section = header.current?.closest("section");
              returnTo.current = section ? (rowNear(section) ?? null) : null;
              removeProject(project.id);
              onOpenChange(false);
            }}
          >
            Remove {name}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function DeleteThread({
  thread,
  open,
  onOpenChange,
}: {
  thread: SidebarThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  const row = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button[data-thread-id]")].find(
      (element) => element.dataset.threadId === thread.id,
    );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup
        finalFocus={() => {
          const target = returnTo.current ?? row();
          returnTo.current = null;
          return target ?? true;
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {thread.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete this pi session from disk, along with its pins, drafts and turn
            checkpoints. This cannot be undone. Stop pi first if it is working. Managed worktrees
            must be removed separately; their branches stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              const item = row()?.closest<HTMLElement>(ITEM);
              returnTo.current = item ? (rowNear(item) ?? null) : null;
              deleteThread(thread.id);
              onOpenChange(false);
            }}
          >
            Delete thread
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

// What the row's 8px status slot shows for each activity.
const ACTIVITY: Record<Exclude<ThreadActivity, "idle">, { label: string; glyph: ReactNode }> = {
  // pi is on its way: a dot at half strength, until the working one takes over.
  starting: {
    label: "Starting pi",
    glyph: <span className="size-1.5 rounded-full bg-muted-foreground/50" />,
  },
  working: { label: "Working", glyph: <StatusDot tone="primary" /> },
  // A ring, so a thread that waits for you doesn't look like one that works.
  waiting: { label: "Waiting for your answer", glyph: <StatusRing /> },
  // A glyph, not a dot: the error red and the working terracotta are too close
  // to tell apart by color alone.
  error: {
    label: "pi stopped with an error",
    glyph: <CircleAlert aria-hidden className="size-3 text-destructive" />,
  },
};

const UNREAD = { label: "Unread", glyph: <StatusDot tone="foreground" /> };

/** What a thread's pi is doing, or that the thread is unread. It doesn't pulse. */
function ActivityDot({ activity, unread }: { activity: ThreadActivity; unread: boolean }) {
  const state = activity !== "idle" ? ACTIVITY[activity] : unread ? UNREAD : null;
  return (
    <span className="flex size-2 shrink-0 items-center justify-center">
      {state ? (
        <span role="img" aria-label={state.label} title={state.label} className="flex">
          {state.glyph}
        </span>
      ) : null}
    </span>
  );
}

function ThreadRow({
  thread,
  open,
  now,
  onDelete,
}: {
  thread: SidebarThread;
  open: boolean;
  now: number;
  onDelete: (thread: SidebarThread) => void;
}) {
  const renaming = useRenaming((id) => id === thread.id);
  const key = `thread:${thread.id}`;
  const tabIndex = useTabStop(key, open);
  const item = useRef<HTMLLIElement>(null);
  const row = useRef<HTMLButtonElement>(null);
  const renamed = useRef(false);
  usePassFocusOn(item);
  // Enter or Escape in the title field ends the rename with focus on the
  // page. It goes back to the row.
  useLayoutEffect(() => {
    if (renaming) {
      renamed.current = true;
    } else if (renamed.current) {
      renamed.current = false;
      if (document.activeElement === document.body) row.current?.focus();
    }
  }, [renaming]);
  const items = (
    <>
      {thread.canRename ? (
        <DropdownMenuItem onClick={() => startRename(thread.id)}>
          <PencilLine aria-hidden />
          Rename
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => pinThread(thread.id, !thread.pinned)}>
        {thread.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {thread.pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={thread.unread} onClick={() => markThreadUnread(thread.id)}>
        <Mail aria-hidden />
        Mark as unread
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(thread)}>
        <Trash2 aria-hidden />
        Delete…
      </DropdownMenuItem>
    </>
  );

  return (
    <ContextMenu disabled={renaming}>
      <ContextMenuTrigger
        data-sidebar-item=""
        onFocus={() => focusRow(key)}
        render={<li ref={item} className="group relative" />}
      >
        {renaming ? (
          <RenameInput thread={thread} />
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    ref={row}
                    type="button"
                    data-sidebar-row=""
                    data-thread-id={thread.id}
                    tabIndex={tabIndex}
                    aria-current={open ? "page" : undefined}
                    aria-label={thread.title}
                    onClick={() => openThread(thread.id)}
                    onKeyDown={openContextMenu}
                    className={`flex h-7 w-full items-center gap-2 rounded-control pr-2 pl-3 text-left text-sm outline-none focus-visible:focus-ring ${
                      open
                        ? "bg-selected text-foreground"
                        : "text-muted-foreground group-has-data-popup-open:bg-accent group-has-data-popup-open:text-foreground group-data-popup-open:bg-accent group-data-popup-open:text-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  />
                }
              >
                <ActivityDot activity={thread.activity} unread={thread.unread} />
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {thread.hasDraft ? (
                  <span
                    role="img"
                    aria-label="Unsent draft"
                    title="Unsent draft"
                    className="flex shrink-0 text-faint-foreground"
                  >
                    <Pen aria-hidden className="size-3" />
                  </span>
                ) : null}
                {thread.pinned ? (
                  <span
                    role="img"
                    aria-label="Pinned"
                    title="Pinned"
                    className="flex shrink-0 text-faint-foreground"
                  >
                    <Pin aria-hidden className="size-3" />
                  </span>
                ) : null}
                {thread.worktree ? (
                  <span
                    role="img"
                    aria-label="Worktree"
                    title="Worktree"
                    className="flex shrink-0 text-faint-foreground"
                  >
                    <GitBranch aria-hidden className="size-3" />
                  </span>
                ) : null}
                {/* The age gives way to the actions button while that shows. It's
                  at least as wide as the button, so the markers stay clear of it. */}
                {thread.activity === "waiting" ? (
                  <span className="min-w-7 shrink-0 text-right text-2xs font-medium text-warning-text group-focus-within:invisible group-hover:invisible group-has-data-popup-open:invisible group-data-popup-open:invisible">
                    Needs input
                  </span>
                ) : (
                  <span className="min-w-7 shrink-0 text-right text-2xs text-faint-foreground tabular-nums group-focus-within:invisible group-hover:invisible group-has-data-popup-open:invisible group-data-popup-open:invisible">
                    {formatAge(thread.updatedAt, now)}
                  </span>
                )}
              </TooltipTrigger>
              <ThreadTooltipContent title={thread.title} model={thread.model} />
            </Tooltip>
            {/* It fades out rather than hides, like the project's buttons, so
                Shift+Tab reaches it as Tab does. Its menu renders outside the
                row, so it stays shown while the menu is open, and closing the
                menu can focus it again. */}
            <div className="absolute inset-y-0 right-0 flex items-center pr-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-popup-open:opacity-100 has-data-popup-open:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" />}
                  aria-label="Thread actions"
                  tabIndex={tabIndex}
                >
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">{items}</DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Thread actions">{items}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Edits a thread's title in place. Enter or leaving the field saves it, and Escape cancels. */
function RenameInput({ thread }: { thread: SidebarThread }) {
  const [name, setName] = useState(thread.title);
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    endRename();
    const trimmed = name.trim();
    if (save && trimmed !== "" && trimmed !== thread.title) renameThread(thread.id, trimmed);
  };
  // The default size is the row's height, 28px, so the rows below don't move.
  return (
    <Input
      aria-label="Thread title"
      autoFocus
      value={name}
      onChange={(event) => setName(event.target.value)}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
