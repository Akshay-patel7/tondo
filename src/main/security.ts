import { net, protocol, shell, type Session, type WebContents } from "electron";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  isExternalHttpUrl,
  resolveAppRequest,
} from "./securityPolicy";

/** Must run before the app's `ready` event. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serves the built renderer from `rootDir` over tondo://, with the CSP on every response. */
export function handleAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveAppRequest(rootDir, request.method, request.url);
    if (resolved.kind === "error") return withCsp(new Response(null, { status: resolved.status }));

    const isFile = await stat(resolved.filePath).then(
      (stats) => stats.isFile(),
      () => false,
    );
    if (!isFile) return withCsp(new Response(null, { status: 404 }));
    return withCsp(await net.fetch(pathToFileURL(resolved.filePath).toString()));
  });
}

function withCsp(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Keeps every web page inside the app: navigation away from the renderer is
 * cancelled, new windows are refused, and http(s) links open in the default
 * browser instead.
 */
export function hardenWebContents(
  contents: WebContents,
  isRendererUrl: (url: string) => boolean,
): void {
  contents.on("will-navigate", (event) => {
    if (isRendererUrl(event.url)) return;
    event.preventDefault();
    openExternally(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function openExternally(url: string): void {
  if (!isExternalHttpUrl(url)) return;
  shell.openExternal(url).catch((error: unknown) => {
    console.error(`Tondo couldn't open ${url} in the default browser:`, error);
  });
}

export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
