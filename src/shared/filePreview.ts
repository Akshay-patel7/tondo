/** A read-only local file preview, requested only when a transcript link is clicked. */
export type FilePreview =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "image";
      readonly path: string;
      readonly mimeType: string;
      readonly data: string;
    }
  | { readonly kind: "error"; readonly message: string };

export const FILE_LINK_PREFIX = "streamdown:local/";
export const FILE_PREVIEW_BYTES = 256 * 1024;

/** Local paths only. Network shares, arbitrary schemes and control characters aren't file links. */
export function isLocalFileLink(value: string): boolean {
  if (!value || value.length > 4096 || value !== value.trim()) return false;
  // oxlint-disable-next-line eslint/no-control-regex -- Reject controls before interpreting a path.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (value.startsWith("//") || value.startsWith("#") || value.startsWith("?")) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value.startsWith("file:///");
  return true;
}

/** The internal URL is inert outside the link dialog; it never grants access to a file. */
export function fileLinkTarget(url: string): string | null {
  if (!url.startsWith(FILE_LINK_PREFIX)) return null;
  try {
    const target = decodeURIComponent(url.slice(FILE_LINK_PREFIX.length));
    return isLocalFileLink(target) ? target : null;
  } catch {
    return null;
  }
}
