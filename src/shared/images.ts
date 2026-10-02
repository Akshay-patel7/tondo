/** Raster image bytes only. Paths and URLs never cross the port as attachments. */
export interface DraftImage {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
}

export const IMAGE_COUNT = 4;
export const IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function imageBytes(data: string): number {
  return (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

/** Decode just the signature, without DOM or Node APIs in the shared layer. */
function signature(data: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < Math.min(16, data.length); i += 4) {
    let bits = 0;
    for (const char of data.slice(i, i + 4))
      bits = (bits << 6) | Math.max(0, alphabet.indexOf(char));
    result += String.fromCharCode((bits >> 16) & 255, (bits >> 8) & 255, bits & 255);
  }
  return result;
}

function matchesType(data: string, type: string): boolean {
  const head = signature(data);
  switch (type) {
    case "image/png":
      return head.startsWith("\x89PNG\r\n\x1a\n");
    case "image/jpeg":
      return head.startsWith("\xff\xd8\xff");
    case "image/gif":
      return head.startsWith("GIF87a") || head.startsWith("GIF89a");
    case "image/webp":
      return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
    default:
      return false;
  }
}

/** A readable boundary error, or null. Check lengths before scanning the base64. */
export function imagesError(value: unknown): string | null {
  if (!Array.isArray(value)) return "Images must be an array.";
  if (value.length > IMAGE_COUNT) return `Attach at most ${IMAGE_COUNT} images.`;
  const ids = new Set<string>();
  let total = 0;
  for (const image of value) {
    if (typeof image !== "object" || image === null || Array.isArray(image))
      return "Invalid image attachment.";
    const { id, name, mimeType, data } = image as Record<string, unknown>;
    if (Object.keys(image).some((key) => !["id", "name", "mimeType", "data"].includes(key)))
      return "Unexpected image field.";
    if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id) || ids.has(id))
      return "Invalid or duplicate image id.";
    ids.add(id);
    if (typeof name !== "string" || name.trim() === "" || name.length > 255)
      return "Invalid image name.";
    if (typeof mimeType !== "string" || !(IMAGE_TYPES as readonly string[]).includes(mimeType))
      return "Use PNG, JPEG, GIF or WebP images.";
    if (typeof data !== "string" || data.length === 0) return "Image data is missing.";
    if (data.length > Math.ceil(IMAGE_BYTES / 3) * 4 || imageBytes(data) > IMAGE_BYTES)
      return "Each image must be 5 MiB or smaller.";
    total += imageBytes(data);
    if (total > IMAGE_TOTAL_BYTES) return "Images must total 10 MiB or less.";
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      return "Invalid base64 image data.";
    if (!matchesType(data, mimeType)) return "Image contents don't match their type.";
  }
  return null;
}
