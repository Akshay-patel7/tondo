import {
  IMAGE_BYTES,
  IMAGE_COUNT,
  IMAGE_TOTAL_BYTES,
  IMAGE_TYPES,
  imagesError,
  type DraftImage,
} from "../../shared/images";

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error(`Couldn't read ${file.name}.`)), {
      once: true,
    });
    reader.addEventListener("load", () => resolve(String(reader.result).split(",", 2)[1]!), {
      once: true,
    });
    reader.readAsDataURL(file);
  });
}

/** All-or-nothing so a failed paste can't leave a partially attached selection. */
export async function readImages(files: readonly File[]): Promise<DraftImage[]> {
  if (files.length > IMAGE_COUNT) throw new Error(`Attach at most ${IMAGE_COUNT} images.`);
  if (files.reduce((sum, file) => sum + file.size, 0) > IMAGE_TOTAL_BYTES)
    throw new Error("Images must total 10 MiB or less.");
  const images: DraftImage[] = [];
  for (const file of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
      throw new Error("Use PNG, JPEG, GIF or WebP images.");
    if (file.size > IMAGE_BYTES) throw new Error("Each image must be 5 MiB or smaller.");
    let bitmap: ImageBitmap;
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Decode one image at a time to bound peak memory.
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(`Couldn't decode ${file.name}.`);
    }
    const pixels = bitmap.width * bitmap.height;
    bitmap.close();
    if (pixels > 16_000_000) throw new Error("Each image must have 16 million pixels or fewer.");
    const image = {
      id: crypto.randomUUID(),
      name: (file.name || "Pasted image").slice(0, 255),
      mimeType: file.type,
      // oxlint-disable-next-line eslint/no-await-in-loop -- Finish reading this file before decoding the next.
      data: await base64(file),
    };
    const error = imagesError([image]);
    if (error) throw new Error(error);
    images.push(image);
  }
  return images;
}
