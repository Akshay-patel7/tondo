import { create } from "zustand";

/** What you're writing in the composer. */
export const useDraft = create<string>()(() => "");

export function setDraft(text: string): void {
  useDraft.setState(text, true);
}

/** Puts `text` back into the composer, ahead of what you're writing, the way pi's editor does. */
export function restoreToDraft(text: string): void {
  setDraft(joinDrafts(text, useDraft.getState()));
}

/** Joins the texts that aren't blank with an empty line between each. */
export function joinDrafts(...texts: readonly string[]): string {
  return texts.filter((text) => text.trim() !== "").join("\n\n");
}
