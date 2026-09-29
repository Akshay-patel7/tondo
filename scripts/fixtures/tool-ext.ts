// A pi extension with a tool of its own, for the tool cards fixture that
// scripts/record-fixtures.mts records. Over RPC an extension's custom
// renderers don't exist, so Tondo shows its calls with the generic card.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const wordCount = defineTool({
  name: "word_count",
  label: "Word count",
  description: "Counts the words in a file",
  parameters: Type.Object({
    path: Type.String({ description: "The file, relative to the working folder" }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const text = readFileSync(path.resolve(ctx.cwd, params.path), "utf8");
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      content: [{ type: "text", text: `${params.path} has ${words} words.` }],
      details: { words },
    };
  },
});

export default function toolExtension(pi: ExtensionAPI): void {
  pi.registerTool(wordCount);
}
