// The sidebar lists your projects and, under each, its threads: the pinned
// ones first, then the newest. The layout follows T3 Code's
// (apps/web/src/components/Sidebar.tsx). T3's rows each take a Tab stop;
// here the rows share one, and the arrow keys, Home and End move between them.
import {
  ChevronRight,
  CircleAlert,
  Ellipsis,
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
  type RefObject,
} from "react";
import type { SidebarProject, SidebarThread, ThreadActivity } from "../../shared/protocol";
import {
  addProject,
  deleteThread,
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
import { openSettings } from "../settings/store";
import { ShellButton } from "../shell/Header";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { toggleSidebarShown } from "./layout";
import { listedThreads, MORE_SIZE, PAGE_SIZE } from "./model";
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

export function Sidebar() {
  const projects = useHost((host) => host.projects);
  const openId = useHost((host) => host.thread?.id);
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
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
    // color, and a solid layer needs no raster tiles. The controls and the
    // list get layers sized to what they show, so a change there redraws a
    // small tile, not one the height of the window. Painted into the page's
    // layer instead, the sidebar would turn each full-width tile row beside
    // it from one solid color into a raster tile, about 15 MiB at 2x.
    <nav
      aria-label="Threads"
      className="relative flex w-64 shrink-0 flex-col border-r border-transparent bg-sidebar will-change-transform"
    >
      <div
        aria-hidden
        className="absolute inset-y-0 -right-px w-px bg-border will-change-transform"
      />
      <div className="shrink-0 will-change-transform">
        <div
          className={`app-drag flex h-10 items-center justify-end gap-0.5 px-2 ${isMac ? "pl-20" : ""}`}
        >
          <ShellButton
            label="Search"
            command="palette"
            disabled={!connected}
            onClick={togglePalette}
          >
            <Search aria-hidden />
          </ShellButton>
          <ShellButton
            label="Settings"
            command="settings"
            disabled={!connected}
            onClick={() => openSettings()}
          >
            <Settings aria-hidden />
          </ShellButton>
          <ShellButton
            label="Hide sidebar"
            command="toggle-sidebar"
            disabled={!connected}
            onClick={toggleSidebarShown}
          >
            <PanelLeft aria-hidden />
          </ShellButton>
        </div>
        <div className="flex items-center justify-between py-1 pr-2 pl-4">
          <h2 className="text-xs font-medium text-muted-foreground">Projects</h2>
          <ShellButton
            label="Add project"
            command="add-project"
            disabled={!connected}
            onClick={addProject}
          >
            <Plus aria-hidden />
          </ShellButton>
        </div>
      </div>
      {/* The top padding and scroll padding keep a focused row's ring in view. */}
      <div className="min-h-0 flex-1 scroll-py-1 overflow-y-auto px-2 pt-1 pb-3">
        <div data-sidebar-list="" className="will-change-transform" onKeyDown={moveFocus}>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p>
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
            <div className="group flex items-center rounded-control pr-1 hover:bg-accent/60 data-popup-open:bg-accent/60 has-data-popup-open:bg-accent/60" />
          }
        >
          <button
            ref={header}
            type="button"
            data-sidebar-row=""
            tabIndex={tabIndex}
            aria-expanded={!project.collapsed}
            title={project.path}
            onClick={() => setCollapsed(project.id, !project.collapsed)}
            onKeyDown={openContextMenu}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 py-1 text-left text-sm font-medium outline-none focus-visible:focus-ring"
          >
            <ChevronRight
              aria-hidden
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                project.collapsed ? "" : "rotate-90"
              }`}
            />
            <span className="truncate">{name}</span>
          </button>
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
        <ul ref={threadList} className="mt-0.5 flex flex-col gap-px">
          {listed.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              open={thread.id === openId}
              now={now}
              onDelete={onDelete}
            />
          ))}
          {listed.length === 0 ? (
            <li className="py-1 pr-2 pl-7 text-xs text-muted-foreground">No threads yet</li>
          ) : null}
          {more > 0 ? (
            <li data-sidebar-item="" onFocus={() => focusRow(moreKey)}>
              <Button
                variant="ghost"
                size="xs"
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

const ACTIVITY: Record<Exclude<ThreadActivity, "idle">, { label: string; look: string }> = {
  starting: { label: "Starting pi", look: "size-1.5 rounded-full bg-muted-foreground/50" },
  working: { label: "Working", look: "size-1.5 rounded-full bg-primary" },
  // A ring, so a thread that waits for you doesn't look like one that works.
  waiting: {
    label: "Waiting for your answer",
    look: "size-2 rounded-full border-[1.5px] border-warning",
  },
  // A glyph, not a dot: the error red and the working terracotta are too close
  // to tell apart by color alone.
  error: { label: "pi stopped with an error", look: "flex text-destructive" },
};

/** What a thread's pi is doing, or that it finished while you were away. It doesn't pulse. */
function ActivityDot({ activity, unread }: { activity: ThreadActivity; unread: boolean }) {
  const dot =
    activity !== "idle"
      ? ACTIVITY[activity]
      : unread
        ? { label: "Unread", look: "size-1.5 rounded-full bg-foreground" }
        : null;
  return (
    <span className="flex size-2 shrink-0 items-center justify-center">
      {dot ? (
        <span role="img" aria-label={dot.label} title={dot.label} className={dot.look}>
          {activity === "error" ? <CircleAlert aria-hidden className="size-3" /> : null}
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
            <button
              ref={row}
              type="button"
              data-sidebar-row=""
              data-thread-id={thread.id}
              tabIndex={tabIndex}
              aria-current={open ? "page" : undefined}
              title={thread.title}
              onClick={() => openThread(thread.id)}
              onKeyDown={openContextMenu}
              className={`flex w-full items-center gap-2 rounded-control py-1 pr-2 pl-2.5 text-left text-sm outline-none focus-visible:focus-ring ${
                open
                  ? "bg-accent text-accent-foreground"
                  : "group-has-data-popup-open:bg-accent/60 group-data-popup-open:bg-accent/60 hover:bg-accent/60"
              }`}
            >
              <ActivityDot activity={thread.activity} unread={thread.unread} />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              {thread.hasDraft ? (
                <span
                  role="img"
                  aria-label="Unsent draft"
                  title="Unsent draft"
                  className="text-muted-foreground"
                >
                  <Pen aria-hidden className="size-3.5" />
                </span>
              ) : null}
              {thread.pinned ? (
                <span
                  role="img"
                  aria-label="Pinned"
                  title="Pinned"
                  className="text-muted-foreground"
                >
                  <Pin aria-hidden className="size-3.5" />
                </span>
              ) : null}
              <span className="w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible group-has-data-popup-open:invisible group-data-popup-open:invisible">
                {formatAge(thread.updatedAt, now)}
              </span>
            </button>
            {/* It fades out rather than hides, like the project's buttons, so
                Shift+Tab reaches it as Tab does. Its menu renders outside the
                row, so it stays shown while the menu is open, and closing the
                menu can focus it again. */}
            <div className="absolute inset-y-0 right-0 flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-popup-open:opacity-100 has-data-popup-open:opacity-100">
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
      // The row's height, so the rows below don't move.
      size="sm"
    />
  );
}
