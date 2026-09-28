import type { SidebarProject, SidebarThread } from "../../shared/protocol";

/**
 * How many threads a project lists before "Show more", and how many more each
 * click shows. T3 Code uses the same counts (SETTLED_TAIL_INITIAL_COUNT and
 * SETTLED_TAIL_PAGE_COUNT in apps/web/src/components/Sidebar.tsx).
 */
export const PAGE_SIZE = 10;
export const MORE_SIZE = 25;

function sameThread(a: SidebarThread, b: SidebarThread): boolean {
  return (Object.keys(a) as (keyof SidebarThread)[]).every((key) => a[key] === b[key]);
}

/**
 * `next`, keeping each project and thread object of `previous` that didn't
 * change, so the rows that didn't change skip rendering.
 */
export function keepUnchanged(
  previous: readonly SidebarProject[],
  next: readonly SidebarProject[],
): readonly SidebarProject[] {
  const oldThreads = new Map(previous.flatMap(({ threads }) => threads).map((t) => [t.id, t]));
  const oldProjects = new Map(previous.map((project) => [project.id, project]));
  return next.map((project) => {
    const threads = project.threads.map((thread) => {
      const old = oldThreads.get(thread.id);
      return old && sameThread(old, thread) ? old : thread;
    });
    const old = oldProjects.get(project.id);
    const same =
      old !== undefined &&
      old.path === project.path &&
      old.collapsed === project.collapsed &&
      old.threads.length === threads.length &&
      old.threads.every((thread, i) => thread === threads[i]);
    return same ? old : { ...project, threads };
  });
}

/**
 * The threads a project lists: its first `count` threads that aren't
 * archived, and the open thread wherever it is. `more` counts the rest.
 */
export function listedThreads(
  threads: readonly SidebarThread[],
  count: number,
  openId: string | undefined,
): { listed: readonly SidebarThread[]; more: number } {
  const active = threads.filter((thread) => !thread.archived);
  const listed = active.slice(0, count);
  const open = active.slice(count).find((thread) => thread.id === openId);
  if (open) listed.push(open);
  return { listed, more: active.length - listed.length };
}

/** The threads of expanded projects, in the sidebar's order, for the shortcuts that move between them. */
export function threadOrder(projects: readonly SidebarProject[]): string[] {
  return projects.flatMap((project) =>
    project.collapsed ? [] : project.threads.filter((t) => !t.archived).map((t) => t.id),
  );
}

/** The thread `step` places from `current` in `order`, wrapping around at the ends. */
export function stepThread(
  order: readonly string[],
  current: string | undefined,
  step: 1 | -1,
): string | undefined {
  if (order.length === 0) return undefined;
  const at = current === undefined ? -1 : order.indexOf(current);
  if (at === -1) return step === 1 ? order[0] : order.at(-1);
  return order[(at + step + order.length) % order.length];
}
