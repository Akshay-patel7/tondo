import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { FILE_PREVIEW_BYTES } from "../shared/filePreview";
import { IMAGE_BYTES } from "../shared/images";
import { IMAGE_FIXTURE } from "../shared/imageFixture";
import { readFilePreview } from "./filePreview";

let dir: string;
let checkout: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tondo-preview-"));
  checkout = path.join(dir, "checkout");
  await mkdir(checkout);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

test("reads relative, absolute and file URLs from the thread checkout", async () => {
  const file = path.join(checkout, "report one.md");
  await writeFile(file, "# Performance report");
  const previews = await Promise.all(
    ["report%20one.md#L1", file, pathToFileURL(file).href].map((target) =>
      readFilePreview(checkout, target),
    ),
  );
  for (const preview of previews)
    expect(preview).toMatchObject({ kind: "text", text: "# Performance report", truncated: false });
});

test("the checkout, not a sibling project, supplies relative files", async () => {
  const project = path.join(dir, "project");
  await mkdir(project);
  await writeFile(path.join(project, "report.md"), "project");
  await writeFile(path.join(checkout, "report.md"), "worktree");
  expect(await readFilePreview(checkout, "report.md")).toMatchObject({
    kind: "text",
    text: "worktree",
  });
});

test("refuses traversal, outside absolute paths and escaping symlinks", async () => {
  const outside = path.join(dir, "secret.txt");
  await writeFile(outside, "secret");
  await symlink(outside, path.join(checkout, "link.txt"));
  const previews = await Promise.all(
    ["../secret.txt", outside, "link.txt", "%2e%2e/secret.txt"].map((target) =>
      readFilePreview(checkout, target),
    ),
  );
  for (const preview of previews)
    expect(preview).toMatchObject({
      kind: "error",
      message: "File previews stay inside this thread's checkout.",
    });
});

test("reads raster images without executing or embedding a file URL", async () => {
  await writeFile(path.join(checkout, "preview.png"), Buffer.from(IMAGE_FIXTURE.data, "base64"));
  expect(await readFilePreview(checkout, "preview.png")).toMatchObject({
    kind: "image",
    data: IMAGE_FIXTURE.data,
    mimeType: "image/png",
  });
});

test("bounds text, rejects large images and doesn't preview binary files or directories", async () => {
  await writeFile(path.join(checkout, "large.md"), "x".repeat(FILE_PREVIEW_BYTES + 20));
  const text = await readFilePreview(checkout, "large.md");
  expect(text.kind).toBe("text");
  if (text.kind !== "text") throw new Error("Missing text preview");
  expect(text.text).toHaveLength(FILE_PREVIEW_BYTES);
  expect(text.truncated).toBe(true);
  await writeFile(
    path.join(checkout, "large.png"),
    Buffer.concat([Buffer.from(IMAGE_FIXTURE.data, "base64"), Buffer.alloc(IMAGE_BYTES)]),
  );
  expect(await readFilePreview(checkout, "large.png")).toMatchObject({ kind: "error" });
  await writeFile(path.join(checkout, "binary"), Buffer.from([0, 1, 2]));
  const previews = await Promise.all(
    ["binary", ".", "missing", "https://example.com", "%zz"].map((target) =>
      readFilePreview(checkout, target),
    ),
  );
  for (const preview of previews) expect(preview).toMatchObject({ kind: "error" });
});
