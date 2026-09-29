// Runs what the app shortcuts and the command palette ask for.
import {
  addProject,
  archiveThread,
  newThread,
  openThread,
  pinThread,
  setCollapsed,
  toggleSidebar,
  useHost,
} from "./connection";
import type { PaletteAction } from "./palette/model";
import { closePalette, togglePalette } from "./palette/store";
import type { AppCommand } from "./shortcuts";
import { stepThread, threadOrder } from "./sidebar/model";
import { startRename } from "./sidebar/store";

/** Starts a thread in the open thread's project, or else the first project, or else adds one. */
export function newThreadHere(): void {
  const { thread, projects } = useHost.getState();
  const projectId = thread?.projectId ?? projects[0]?.id;
  if (projectId === undefined) addProject();
  else newThread(projectId);
}

export function runAppCommand(command: AppCommand): void {
  // The page can't ask the host for anything until main hands it a port.
  if (useHost.getState().connection !== "connected") return;
  if (command.type === "palette") {
    togglePalette();
    return;
  }
  closePalette();
  const { thread, projects } = useHost.getState();
  switch (command.type) {
    case "sidebar":
      toggleSidebar();
      break;
    case "new-thread":
      newThreadHere();
      break;
    case "add-project":
      addProject();
      break;
    case "step-thread": {
      const id = stepThread(threadOrder(projects), thread?.id, command.step);
      if (id !== undefined) openThread(id);
      break;
    }
    case "jump-to-thread": {
      const id = threadOrder(projects)[command.index];
      if (id !== undefined) openThread(id);
      break;
    }
  }
}

export function runPaletteAction(action: PaletteAction): void {
  closePalette();
  switch (action.type) {
    case "new-thread":
      newThread(action.projectId);
      break;
    case "add-project":
      addProject();
      break;
    case "toggle-sidebar":
      toggleSidebar();
      break;
    case "rename-thread": {
      // The title is edited in place, so the sidebar has to show the thread.
      const { sidebarHidden, projects } = useHost.getState();
      if (sidebarHidden) toggleSidebar();
      const project = projects.find(({ threads }) => threads.some((t) => t.id === action.threadId));
      if (project?.collapsed) setCollapsed(project.id, false);
      startRename(action.threadId);
      break;
    }
    case "pin-thread":
      pinThread(action.threadId, action.pinned);
      break;
    case "archive-thread":
      archiveThread(action.threadId, action.archived);
      break;
    case "open-thread":
      if (action.archived) archiveThread(action.threadId, false);
      openThread(action.threadId);
      break;
  }
}
