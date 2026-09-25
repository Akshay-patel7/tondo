// resolveAppRequest follows serveDesktopAsset in T3 Code's
// apps/desktop/src/electron/ElectronProtocol.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import path from "node:path";

export const APP_SCHEME = "tondo";
export const APP_HOST = "app";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;

/**
 * Sent with every tondo:// response. The built renderer is one HTML file plus
 * hashed scripts and stylesheets, so nothing needs inline code or other origins.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export type AppRequest =
  | { kind: "file"; filePath: string }
  | { kind: "error"; status: 400 | 404 | 405 };

/** Maps a tondo:// request to a file under `rootDir`, refusing anything outside it. */
export function resolveAppRequest(rootDir: string, method: string, url: string): AppRequest {
  const { host, pathname } = new URL(url);
  if (host !== APP_HOST) return { kind: "error", status: 404 };
  if (method !== "GET" && method !== "HEAD") return { kind: "error", status: 405 };

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: "error", status: 400 };
  }
  if (decoded.includes("\0")) return { kind: "error", status: 400 };

  const root = path.resolve(rootDir);
  const relative = decoded === "" || decoded === "/" ? "index.html" : `.${decoded}`;
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) return { kind: "error", status: 404 };
  return { kind: "file", filePath };
}

/**
 * Compares scheme and host (with port). URL.origin can't be used because Node
 * reports "null" as the origin of any tondo:// URL.
 */
export function isSameOrigin(url: string, base: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(base);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/** Only http and https links leave the app, and they open in the default browser. */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
