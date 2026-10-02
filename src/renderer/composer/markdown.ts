// Like T3 Code's ComposerPromptEditorTiptap.tsx plain mode, the composer
// keeps Markdown markers literal and represents each newline as a paragraph.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

/** Markdown source, without parsing HTML, changing whitespace or hiding markers. */
export function markdownDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line === "" ? [] : [{ type: "text", text: line }],
    })),
  };
}

export function documentMarkdown(doc: Node): string {
  const lines: string[] = [];
  doc.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join("\n");
}

/** ProseMirror counts the opening and closing of each paragraph; Markdown counts one newline. */
export function markdownOffset(doc: Node, position: number): number {
  let offset = 0;
  let result = 0;
  doc.forEach((paragraph, start) => {
    if (position >= start + 1) {
      result = offset + Math.min(position - start - 1, paragraph.content.size);
    }
    offset += paragraph.textContent.length + 1;
  });
  return result;
}

/** Maps a Markdown offset to a position inside a paragraph, including empty and final lines. */
export function documentPosition(doc: Node, offset: number): number {
  let remaining = Math.max(0, offset);
  let result = 1;
  let found = false;
  doc.forEach((paragraph, start) => {
    if (found) return;
    result = start + 1 + Math.min(remaining, paragraph.content.size);
    if (remaining <= paragraph.content.size) found = true;
    remaining -= paragraph.content.size + 1;
  });
  return result;
}
