import { describe, expect, test } from "vitest";
import { callPreview } from "./preview";
import type { CallStatus, ToolCall } from "./model";

function preview(name: string, text: string, status: CallStatus = "done", patch?: string) {
  const call: ToolCall = { type: "toolCall", id: "call", name, arguments: {} };
  return callPreview({ call, status, output: { content: [{ type: "text", text }] }, patch });
}

describe("callPreview", () => {
  test("shows the first search results and marks omitted output", () => {
    expect(preview("grep", "a:1: match\nb:2: match\nc:3: match\nd:4: match")).toEqual({
      kind: "output",
      text: "a:1: match\nb:2: match\nc:3: match",
      live: false,
      more: true,
    });
    expect(preview("find", "No files found")).toMatchObject({
      text: "No files found",
      more: false,
    });
  });

  test("shows the last command lines while running and keeps a shorter result after completion", () => {
    const text = "1\n2\n3\n4\n5\n6\n";
    expect(preview("bash", text, "running")).toMatchObject({ text: "2\n3\n4\n5\n6", live: true });
    expect(preview("bash", text)).toMatchObject({ text: "4\n5\n6", live: false, more: true });
    expect(preview("powershell", text, "failed")).toMatchObject({ kind: "error", text: "4\n5\n6" });
  });

  test("keeps successful file operations quiet, but exposes their errors", () => {
    for (const name of ["read", "write", "ls"]) {
      expect(preview(name, "file content")).toBeNull();
      expect(preview(name, "File not found", "failed")).toMatchObject({
        kind: "error",
        text: "File not found",
        live: false,
      });
    }
  });

  test("shows actual patch changes and locations, without confusing file headers with changes", () => {
    const patch =
      "--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n@@ -10 +10 @@\n-before\n+after\n";
    expect(preview("edit", "Edited a.ts", "done", patch)).toEqual({
      kind: "diff",
      text: "@@ -1,2 +1,2 @@\n-old\n+new",
      live: false,
      more: true,
    });
    expect(preview("edit", "Could not apply edit", "failed", patch)?.text).toBe(
      "Could not apply edit",
    );
  });

  test("does not label pending calls or missing output as completed work", () => {
    expect(preview("grep", "partial", "running")).toBeNull();
    expect(preview("bash", "partial", "waiting")).toBeNull();
    expect(preview("bash", "partial", "writing")).toBeNull();
    expect(preview("bash", "partial", "stopped")).toBeNull();
    expect(preview("bash", " \n")).toBeNull();
    expect(
      callPreview({
        call: { type: "toolCall", id: "a", name: "bash", arguments: {} },
        status: "done",
        output: null,
        patch: undefined,
      }),
    ).toBeNull();
  });

  test("takes bounded excerpts from large results, multiple blocks and patches", () => {
    const large = `FIRST\n${"middle\n".repeat(100_000)}LAST`;
    expect(preview("grep", large)).toMatchObject({ text: "FIRST\nmiddle\nmiddle", more: true });
    expect(preview("bash", large)).toMatchObject({ text: "middle\nmiddle\nLAST", more: true });
    expect(preview("bash", `${"x".repeat(100_000)}END`)?.text.endsWith("END")).toBe(true);
    const patch = `--- a\n+++ a\n@@ -1 +1 @@\n-old\n+new\n${" context\n".repeat(100_000)}`;
    expect(preview("edit", "Edited", "done", patch)).toMatchObject({
      text: "@@ -1 +1 @@\n-old\n+new",
      more: true,
    });
    const call: ToolCall = { type: "toolCall", id: "blocks", name: "bash", arguments: {} };
    const output = {
      content: [
        { type: "text" as const, text: large },
        { type: "image" as const, data: "AAAA", mimeType: "image/png" },
        { type: "text" as const, text: "final block" },
      ],
    };
    expect(callPreview({ call, status: "done", output, patch: undefined })).toMatchObject({
      text: "LAST\n[image: image/png]\nfinal block",
      more: true,
    });
  });

  test("bounds long lines, strips terminal escapes, and keeps extension output as plain text", () => {
    expect(preview("custom", "x".repeat(10_000))).toMatchObject({
      text: `${"x".repeat(240)}…`,
      more: true,
    });
    expect(preview("custom", "\u001b[31m<script>not markup</script>\u001b[0m")?.text).toBe(
      "<script>not markup</script>",
    );
  });
});
