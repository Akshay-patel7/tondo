import { create } from "zustand";
import type { DraftImage } from "../../shared/images";

/** What you're writing in the composer, for the thread on screen. */
export const useDraft = create<string>()(() => "");

/** Image bytes change only on attachment edits, never on a text keystroke. */
export const useDraftImages = create<readonly DraftImage[]>()(() => []);

/** Shows `text` in the composer. connection.ts's editDraft also saves it. */
export function setDraft(text: string): void {
  useDraft.setState(text, true);
}

/** Joins the texts that aren't blank with an empty line between each, the way pi's editor restores its queue. */
export function joinDrafts(...texts: readonly string[]): string {
  return texts.filter((text) => text.trim() !== "").join("\n\n");
}
