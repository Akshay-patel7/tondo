import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { PickedFiles } from "../shared/attachments";
import {
  IMAGE_BYTES,
  IMAGE_COUNT,
  IMAGE_TOTAL_BYTES,
  imageBytes,
  imagesError,
  imageType,
  type DraftImage,
} from "../shared/images";

const EXTENSIONS: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Read at most limit + 1 bytes, even if the file grows after stat. */
async function readBounded(file: FileHandle, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < buffer.length) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- A short read must finish before advancing its offset.
    const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

/** Called only with paths supplied by main's native file dialog, never page-supplied paths. */
export async function readPickedFiles(selected: readonly string[]): Promise<PickedFiles> {
  const images: DraftImage[] = [];
  const paths: string[] = [];
  for (const selectedPath of new Set(selected)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Read one selected file at a time to bound memory and open handles.
    const file = await open(selectedPath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Check the open handle, not an earlier path lookup.
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error(`Choose a regular file: ${selectedPath}`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Only a small signature is read for non-images.
      const header = await readBounded(file, 11);
      const mimeType =
        imageType(header.toString("base64")) ??
        EXTENSIONS[path.extname(selectedPath).toLowerCase()];
      if (mimeType === undefined) {
        paths.push(selectedPath);
        continue;
      }
      if (images.length >= IMAGE_COUNT) throw new Error(`Attach at most ${IMAGE_COUNT} images.`);
      if (stat.size > IMAGE_BYTES) throw new Error("Each image must be 5 MiB or smaller.");
      if (
        stat.size + images.reduce((sum, image) => sum + imageBytes(image.data), 0) >
        IMAGE_TOTAL_BYTES
      )
        throw new Error("Images must total 10 MiB or less.");
      // oxlint-disable-next-line eslint/no-await-in-loop -- The bounded read also checks files that grow after stat.
      const data = await readBounded(file, IMAGE_BYTES);
      const image = {
        id: randomUUID(),
        name: path.basename(selectedPath).slice(0, 255),
        mimeType,
        data: data.toString("base64"),
      };
      const error = imagesError([...images, image]);
      if (error) throw new Error(error);
      images.push(image);
    } finally {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Always close this selection before opening the next.
      await file.close();
    }
  }
  return { images, paths };
}
