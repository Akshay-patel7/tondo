// The sidebar lists your projects and, under each, its threads: the pinned
// ones first, then the newest. The layout follows T3 Code's
// (apps/web/src/components/Sidebar.tsx).
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { SidebarProject, SidebarThread, ThreadActivity } from "../../shared/protocol";
import {
  addProject,
  archiveThread,
  newThread,
  openThread,
  pinThread,
  removeProject,
  renameThread,
  setCollapsed,
  toggleSidebar,
  useHost,
} from "../connection";
import { folderName, formatAge } from "../format";
import { togglePalette } from "../palette/store";
import { isMac } from "../platform";
import { shortcutLabel } from "../shortcuts";
import {
  ChevronIcon,
  MoreIcon,
  PenIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
} from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { Menu, type MenuItem, type MenuPoint } from "../ui/Menu";
import { listedThreads, MORE_SIZE, PAGE_SIZE } from "./model";
import { endRename, startRename, useRenaming } from "./store";

/** The time, updated each minute, so the threads' ages stay current. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Opens a menu under the button that was clicked, lined up with its right edge. */
function below(event: MouseEvent<HTMLElement>): MenuPoint {
  const { right, bottom } = event.currentTarget.getBoundingClientRect();
  return { x: right, y: bottom + 4, alignRight: true };
}

/** Opens a menu where you right-clicked. */
function atPointer(event: MouseEvent<HTMLElement>): MenuPoint {
  event.preventDefault();
  return { x: event.clientX, y: event.clientY };
}

export function Sidebar() {
  const projects = useHost((host) => host.projects);
  const openId = useHost((host) => host.thread?.id);
  // The page can't ask the host for anything until main hands it a port.
  const connected = useHost((host) => host.connection === "connected");
  const now = useMinute();
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
          <IconButton
            label="Search"
            shortcut={shortcutLabel("K", isMac)}
            disabled={!connected}
            onClick={togglePalette}
          >
            <SearchIcon />
          </IconButton>
          <IconButton
            label="Hide sidebar"
            shortcut={shortcutLabel("B", isMac)}
            disabled={!connected}
            onClick={toggleSidebar}
          >
            <SidebarIcon />
          </IconButton>
        </div>
        <div className="flex items-center justify-between py-1 pr-2 pl-4">
          <h2 className="text-xs font-medium text-muted-foreground">Projects</h2>
          <IconButton
            label="Add project"
            shortcut={shortcutLabel("O", isMac)}
            disabled={!connected}
            onClick={addProject}
          >
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="will-change-transform">
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p>
          ) : null}
          {projects.map((project) => (
            <ProjectGroup key={project.id} project={project} openId={openId} now={now} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function ProjectGroup({
  project,
  openId,
  now,
}: {
  project: SidebarProject;
  openId: string | undefined;
  now: number;
}) {
  const [count, setCount] = useState(PAGE_SIZE);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [confirming, setConfirming] = useState(false);
  const name = folderName(project.path);
  const { listed, more } = listedThreads(project.threads, count, openId);
  const closeMenu = () => {
    setMenu(null);
    setConfirming(false);
  };
  const menuItems: MenuItem[] = confirming
    ? [
        { label: "Cancel", onSelect: closeMenu },
        {
          label: `Remove ${name}`,
          destructive: true,
          onSelect: () => {
            closeMenu();
            removeProject(project.id);
          },
        },
      ]
    : [
        {
          label: "New thread",
          onSelect: () => {
            closeMenu();
            newThread(project.id);
          },
        },
        { label: "Remove project…", destructive: true, onSelect: () => setConfirming(true) },
      ];

  return (
    <section aria-label={name} className="mt-2 first:mt-0">
      <div
        className="group flex items-center rounded-control pr-1 hover:bg-accent/60"
        onContextMenu={(event) => setMenu(atPointer(event))}
      >
        <button
          type="button"
          aria-expanded={!project.collapsed}
          title={project.path}
          onClick={() => setCollapsed(project.id, !project.collapsed)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 py-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronIcon open={!project.collapsed} />
          <span className="truncate">{name}</span>
        </button>
        <IconButton
          label={`New thread in ${name}`}
          onClick={() => newThread(project.id)}
          className="invisible size-6 group-focus-within:visible group-hover:visible"
        >
          <PlusIcon />
        </IconButton>
        <IconButton
          label="Project actions"
          onClick={(event) => setMenu(below(event))}
          className="invisible size-6 group-focus-within:visible group-hover:visible"
        >
          <MoreIcon />
        </IconButton>
      </div>
      {menu ? (
        <Menu
          key={confirming ? "confirm" : "actions"}
          label={`${name} actions`}
          at={menu}
          items={menuItems}
          note={
            confirming
              ? "Tondo forgets the project's pins, drafts and archive. pi's session files stay on disk."
              : undefined
          }
          onClose={closeMenu}
        />
      ) : null}
      {project.collapsed ? null : (
        <ul className="mt-0.5 flex flex-col gap-px">
          {listed.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} open={thread.id === openId} now={now} />
          ))}
          {listed.length === 0 ? (
            <li className="py-1 pr-2 pl-7 text-xs text-muted-foreground">No threads yet</li>
          ) : null}
          {more > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setCount(count + MORE_SIZE)}
                className="rounded-control py-1 pr-2 pl-7 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show {Math.min(more, MORE_SIZE)} more
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

const ACTIVITY: Record<Exclude<ThreadActivity, "idle">, { label: string; look: string }> = {
  starting: { label: "Starting pi", look: "size-1.5 bg-muted-foreground/50" },
  working: { label: "Working", look: "size-1.5 bg-primary" },
  // A ring, so a thread that waits for you doesn't look like one that works.
  waiting: { label: "Waiting for your answer", look: "size-2 border-[1.5px] border-warning" },
  error: { label: "pi stopped with an error", look: "size-1.5 bg-destructive" },
};

/** What a thread's pi is doing, or that it finished while you were away. It doesn't pulse. */
function ActivityDot({ activity, unread }: { activity: ThreadActivity; unread: boolean }) {
  const dot =
    activity !== "idle"
      ? ACTIVITY[activity]
      : unread
        ? { label: "Unread", look: "size-1.5 bg-foreground" }
        : null;
  return (
    <span className="flex size-2 shrink-0 items-center justify-center">
      {dot ? (
        <span
          role="img"
          aria-label={dot.label}
          title={dot.label}
          className={`rounded-full ${dot.look}`}
        />
      ) : null}
    </span>
  );
}

function ThreadRow({ thread, open, now }: { thread: SidebarThread; open: boolean; now: number }) {
  const renaming = useRenaming((id) => id === thread.id);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const actions = useRef<HTMLButtonElement>(null);
  if (renaming) {
    return (
      <li>
        <RenameInput thread={thread} />
      </li>
    );
  }

  const closeMenu = () => {
    setMenu(null);
    actions.current?.focus();
  };
  const menuItems: MenuItem[] = [
    ...(thread.canRename
      ? [
          {
            label: "Rename",
            onSelect: () => {
              closeMenu();
              startRename(thread.id);
            },
          },
        ]
      : []),
    {
      label: thread.pinned ? "Unpin" : "Pin",
      onSelect: () => {
        closeMenu();
        pinThread(thread.id, !thread.pinned);
      },
    },
    {
      label: "Archive",
      onSelect: () => {
        closeMenu();
        archiveThread(thread.id, true);
      },
    },
  ];

  return (
    <li className="group relative" onContextMenu={(event) => setMenu(atPointer(event))}>
      <button
        type="button"
        aria-current={open ? "page" : undefined}
        title={thread.title}
        onClick={() => openThread(thread.id)}
        className={`flex w-full items-center gap-2 rounded-control py-1 pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          open ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
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
            <PenIcon />
          </span>
        ) : null}
        {thread.pinned ? (
          <span role="img" aria-label="Pinned" title="Pinned" className="text-muted-foreground">
            <PinIcon />
          </span>
        ) : null}
        <span
          className={`w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible ${menu ? "invisible" : ""}`}
        >
          {formatAge(thread.updatedAt, now)}
        </span>
      </button>
      <IconButton
        ref={actions}
        label="Thread actions"
        onClick={(event) => setMenu(below(event))}
        // Its menu renders outside the row, so it stays shown while the menu
        // is open, and closing the menu can focus it again.
        className={`absolute top-1/2 right-1 size-6 -translate-y-1/2 ${menu ? "visible" : "invisible group-focus-within:visible group-hover:visible"}`}
      >
        <MoreIcon />
      </IconButton>
      {menu ? (
        <Menu label="Thread actions" at={menu} items={menuItems} onClose={closeMenu} />
      ) : null}
    </li>
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
    <input
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
      // 3px plus the border matches the row's py-1, so the rows below don't move.
      className="w-full rounded-control border border-ring bg-card px-2.5 py-[3px] text-sm outline-none"
    />
  );
}
