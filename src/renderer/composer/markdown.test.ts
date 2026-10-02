import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { describe, expect, test } from "vitest";
import { documentMarkdown, documentPosition, markdownDocument, markdownOffset } from "./markdown";

const schema = getSchema([Document, Paragraph, Text]);

const sources = [
  "",
  "one line",
  "first\nsecond",
  "\n\n",
  "\n indented\n\nlast  \n",
  "# Heading\n\n**bold** and _literal_\n```ts\n  const x = '<p>not HTML</p>';\n```\n",
  'Look at @"space name.txt" and @plain.txt ',
  "你好 👩🏽‍💻\n😀 café é\n",
];

describe("Markdown source documents", () => {
  test.each(sources)("round trips without rewriting %j", (source) => {
    const doc = schema.nodeFromJSON(markdownDocument(source));
    expect(documentMarkdown(doc)).toBe(source);
    expect(doc.childCount).toBe(source.split("\n").length);
    // Every offset, including those beside newlines and within UTF-16 pairs.
    for (let offset = 0; offset <= source.length; offset++) {
      expect(markdownOffset(doc, documentPosition(doc, offset))).toBe(offset);
    }
  });

  test("clamps positions outside the document", () => {
    const doc = schema.nodeFromJSON(markdownDocument("ab\nc"));
    expect(documentPosition(doc, -10)).toBe(1);
    expect(documentPosition(doc, 100)).toBe(doc.content.size - 1);
    expect(markdownOffset(doc, 0)).toBe(0);
    expect(markdownOffset(doc, doc.content.size)).toBe(4);
  });

  test("serializes a partial clipboard selection with empty lines", () => {
    const doc = schema.nodeFromJSON(markdownDocument("abc\n\ndef"));
    const slice = doc.slice(documentPosition(doc, 1), documentPosition(doc, 7));
    expect(slice.content.textBetween(0, slice.content.size, "\n")).toBe("bc\n\nde");
  });
});
