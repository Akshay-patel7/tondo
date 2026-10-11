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

// The host applies the same rules to a thread that isn't on screen.
export { editorText, joinDrafts } from "../../shared/drafts";
