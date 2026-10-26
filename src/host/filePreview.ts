import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_PREVIEW_BYTES, isLocalFileLink, type FilePreview } from "../shared/filePreview";
import { IMAGE_BYTES, imageType } from "../shared/images";

/** No file IO runs until a user opens a link. Resolve against the thread's actual checkout. */
export async function readFilePreview(checkout: string, target: string): Promise<FilePreview> {
  try {
    if (!isLocalFileLink(target)) throw new Error("This is not a local file link.");
    const requested = target.startsWith("file:///")
      ? fileURLToPath(new URL(target))
      : decodeURIComponent(target.split(/[?#]/, 1)[0]!);
    // Check both spelling and canonical path so neither traversal nor symlinks leave the checkout.
    const root = await realpath(checkout);
    const candidate = path.resolve(checkout, requested);
    if (!inside(path.resolve(checkout), candidate) && !inside(root, candidate))
      throw new Error("File previews stay inside this thread's checkout.");
    const resolved = await realpath(candidate);
    if (!inside(root, resolved))
      throw new Error("File previews stay inside this thread's checkout.");
    const file = await open(
      resolved,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("Choose a regular file.");
      const header = Buffer.alloc(12);
      await file.read(header, 0, header.length, 0);
      const mimeType = imageType(header.toString("base64"));
      const limit = mimeType ? IMAGE_BYTES : FILE_PREVIEW_BYTES;
      if (mimeType && stat.size > limit)
        throw new Error("Image previews must be 5 MiB or smaller.");
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < buffer.length) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Short reads must advance before reading the next chunk.
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (mimeType) {
        if (length > limit) throw new Error("Image previews must be 5 MiB or smaller.");
        return {
          kind: "image",
          path: resolved,
          mimeType,
          data: buffer.subarray(0, length).toString("base64"),
        };
      }
      const bytes = buffer.subarray(0, Math.min(length, limit));
      if (bytes.includes(0)) throw new Error("This binary file has no text preview.");
      return {
        kind: "text",
        path: resolved,
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: length > limit }),
        truncated: length > limit,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
