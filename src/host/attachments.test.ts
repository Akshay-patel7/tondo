import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMAGE_FIXTURE } from "../shared/imageFixture";
import { IMAGE_BYTES } from "../shared/images";
import { readPickedFiles } from "./attachments";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tondo-attachments-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string | Buffer): string {
  const selected = path.join(dir, name);
  writeFileSync(selected, content);
  return selected;
}
const png = Buffer.from(IMAGE_FIXTURE.data, "base64");

describe("native file selection", () => {
  it("splits a mixed selection, detects image signatures without extensions and preserves original paths", async () => {
    const csv = file("data.csv", "name,total\ncanary,4217\n");
    const image = file("no-extension", png);
    const binary = file("archive.unknown", Buffer.from([0, 255, 1]));
    const selected = await readPickedFiles([csv, image, binary, image]);
    expect(selected.paths).toEqual([csv, binary]);
    expect(selected.images).toEqual([
      expect.objectContaining({
        name: "no-extension",
        mimeType: "image/png",
        data: IMAGE_FIXTURE.data,
      }),
    ]);
  });

  it("does not apply image limits to non-image files", async () => {
    const paths = Array.from({ length: 5 }, (_, i) =>
      file(`large-${i}.bin`, Buffer.alloc(IMAGE_BYTES + 1)),
    );
    expect(await readPickedFiles(paths)).toEqual({ paths, images: [] });
  });

  it("recognizes uppercase image extensions and rejects invalid signatures", async () => {
    await expect(readPickedFiles([file("broken.PNG", "not an image")])).rejects.toThrow(
      "Image contents don't match their type.",
    );
  });

  it("leaves SVG as a path, not a raster image attachment", async () => {
    const svg = file("vector.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await readPickedFiles([svg])).toEqual({ paths: [svg], images: [] });
  });

  it("returns an empty selection when cancelled", async () => {
    expect(await readPickedFiles([])).toEqual({ paths: [], images: [] });
  });

  it("rejects more than four images", async () => {
    const paths = Array.from({ length: 5 }, (_, i) => file(`image-${i}.png`, png));
    await expect(readPickedFiles(paths)).rejects.toThrow("Attach at most 4 images.");
  });

  it("rejects an image over 5 MiB before reading its body", async () => {
    await expect(
      readPickedFiles([file("huge.png", Buffer.alloc(IMAGE_BYTES + 1))]),
    ).rejects.toThrow("Each image must be 5 MiB or smaller.");
  });

  it("rejects a selection over the total image-byte limit", async () => {
    const bytes = Buffer.alloc(3 * 1024 * 1024);
    png.copy(bytes);
    const paths = Array.from({ length: 4 }, (_, i) => file(`image-${i}.png`, bytes));
    await expect(readPickedFiles(paths)).rejects.toThrow("Images must total 10 MiB or less.");
  });

  it("reports files removed before reading and refuses directories", async () => {
    await expect(readPickedFiles([path.join(dir, "gone.csv")])).rejects.toThrow("ENOENT");
    const folder = path.join(dir, "folder");
    mkdirSync(folder);
    await expect(readPickedFiles([folder])).rejects.toThrow("Choose a regular file:");
  });
});
