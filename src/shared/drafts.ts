/** Joins the texts that aren't blank with an empty line between each, the way pi's editor restores its queue. */
export function joinDrafts(...texts: readonly string[]): string {
  return texts.filter((text) => text.trim() !== "").join("\n\n");
}

/**
 * A thread's draft after an extension sets the composer's text to `text`. The
 * text the extension set last (`extensionSet`) is replaced while it's still at
 * the end of the draft unchanged. Text you typed stays, with the extension's after it.
 */
export function editorText(draft: string, text: string, extensionSet: string | undefined): string {
  let typed = draft;
  if (extensionSet !== undefined && extensionSet !== "") {
    if (draft === extensionSet) typed = "";
    else if (draft.endsWith(`\n\n${extensionSet}`)) {
      typed = draft.slice(0, -(extensionSet.length + 2));
    }
  }
  return joinDrafts(typed, text);
}
