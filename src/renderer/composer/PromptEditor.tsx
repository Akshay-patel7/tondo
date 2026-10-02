// Plain Markdown and controlled updates follow T3 Code's
// apps/web/src/components/ComposerPromptEditorTiptap.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { splitBlock } from "@tiptap/pm/commands";
import { closeHistory } from "@tiptap/pm/history";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useImperativeHandle, useLayoutEffect, type Ref } from "react";
import { documentMarkdown, documentPosition, markdownDocument, markdownOffset } from "./markdown";

const EXTENSIONS = [Document, Paragraph, Text, UndoRedo];

export interface EditorSnapshot {
  readonly text: string;
  /** Markdown offsets, not ProseMirror positions. */
  readonly from: number;
  readonly to: number;
}

export interface PromptEditorHandle {
  focus(): void;
  replace(text: string, caret: number): void;
}

interface Props {
  readonly ref: Ref<PromptEditorHandle>;
  readonly value: string;
  readonly placeholder: string;
  readonly menuId?: string | undefined;
  readonly activeOption?: string | undefined;
  readonly onChange: (text: string) => void;
  readonly onSelection: (snapshot: EditorSnapshot) => void;
  /** True when the composer handled the key. */
  readonly onKeyDown: (event: KeyboardEvent, snapshot: EditorSnapshot) => boolean;
}

function snapshot(editor: Editor): EditorSnapshot {
  const { doc, selection } = editor.state;
  return {
    text: documentMarkdown(doc),
    from: markdownOffset(doc, selection.from),
    to: markdownOffset(doc, selection.to),
  };
}

/** One undo step, separate from typing before and after it. A caret move alone never replaces text. */
function replace(editor: Editor, text: string, caret: number): void {
  const tr = closeHistory(editor.state.tr);
  if (documentMarkdown(tr.doc) !== text) {
    const next = editor.schema.nodeFromJSON(markdownDocument(text));
    tr.replaceWith(0, tr.doc.content.size, next.content);
  }
  tr.setSelection(TextSelection.create(tr.doc, documentPosition(tr.doc, caret)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
}

/**
 * TipTap owns selection and undo. The store owns Markdown. Echoes of local
 * edits never replace the document, and selection changes never save a draft.
 * The parent mounts a fresh editor when the thread id changes.
 */
export function PromptEditor({
  ref,
  value,
  placeholder,
  menuId,
  activeOption,
  onChange,
  onSelection,
  onKeyDown,
}: Props) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: markdownDocument(value),
    injectCSS: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Message",
        "aria-multiline": "true",
        "aria-placeholder": placeholder,
        "data-placeholder": placeholder,
        ...(menuId ? { "aria-controls": menuId } : {}),
        ...(activeOption ? { "aria-activedescendant": activeOption } : {}),
        class:
          "composer-editor min-h-24 max-h-60 w-full overflow-y-auto bg-transparent px-4 pt-3 pb-1 outline-none",
      },
      handleKeyDown: (view, event) => {
        // 229 also covers an IME's final Enter on browsers that already
        // cleared isComposing. Never send or split that candidate key.
        if (event.isComposing || view.composing || event.keyCode === 229) {
          if (event.key === "Enter") event.stopPropagation();
          return event.key === "Enter";
        }
        const { doc, selection } = view.state;
        const state = {
          text: documentMarkdown(doc),
          from: markdownOffset(doc, selection.from),
          to: markdownOffset(doc, selection.to),
        };
        if (onKeyDown(event, state)) return true;
        if (event.key !== "Enter") return false;
        // A newline is a new paragraph, never a hardBreak or a Markdown rewrite.
        return splitBlock(view.state, (tr) => view.dispatch(tr.scrollIntoView()));
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data || data.files.length > 0) return false;
        const text = data.getData("text/plain");
        if (!text) return false;
        const doc = view.state.schema.nodeFromJSON(markdownDocument(text.replaceAll("\r\n", "\n")));
        view.dispatch(
          closeHistory(view.state.tr)
            .replaceSelection(new Slice(doc.content, 1, 1))
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste")
            .scrollIntoView(),
        );
        view.dispatch(closeHistory(view.state.tr));
        return true;
      },
      clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, "\n"),
    },
    onUpdate: ({ editor: updated }) => onChange(documentMarkdown(updated.state.doc)),
    onSelectionUpdate: ({ editor: updated }) => onSelection(snapshot(updated)),
  });

  useLayoutEffect(() => {
    if (editor && documentMarkdown(editor.state.doc) !== value) {
      replace(editor, value, value.length);
    }
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      replace: (text, caret) => {
        if (editor) replace(editor, text, caret);
      },
    }),
    [editor],
  );

  return <EditorContent editor={editor} />;
}
