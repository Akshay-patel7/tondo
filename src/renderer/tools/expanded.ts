import { create } from "zustand";

/**
 * The tool calls whose cards you opened in the thread on screen. The cards
 * read it here rather than keeping it themselves, because the timeline can
 * unmount a row once you scroll away from it.
 */
export const useExpanded = create<ReadonlySet<string>>()(() => new Set());

export function toggleExpanded(id: string): void {
  useExpanded.setState((ids) => {
    const next = new Set(ids);
    if (!next.delete(id)) next.add(id);
    return next;
  }, true);
}

/** A newly opened thread starts with every card closed. */
export function collapseAll(): void {
  useExpanded.setState(new Set(), true);
}
