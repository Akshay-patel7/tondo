import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { RemotePairings } from "./remotePairings";
import { parseClientMessage, PROTOCOL_VERSION as v } from "../shared/protocol";
import {
  REMOTE_CLOSE_UNAVAILABLE,
  REMOTE_FRAME_BYTES,
  REMOTE_MAX_CLIENTS,
  REMOTE_PORT,
  REMOTE_REQUEST_BYTES,
  remoteRequestAllowed,
  type HostToRemote,
  type RemoteToHost,
} from "../shared/remote";

// Browsers cap persistent cookies at 400 days. Refresh on authenticated visits;
// the Mac keeps the device authorized until remote access is explicitly disabled.
const COOKIE_SECONDS = 400 * 24 * 60 * 60;
const COOKIE = "tondo_remote";
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function acceptsGzip(header: string | undefined): boolean {
  return (
    header?.split(",").some((part) => {
      const [encoding, ...parameters] = part.trim().toLowerCase().split(";");
      return (
        encoding === "gzip" && !parameters.some((value) => /^q=0(?:\.0*)?$/.test(value.trim()))
      );
    }) ?? false
  );
}

function reject(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

export function requestOrigin(request: IncomingMessage): string | null {
  const host = request.headers.host;
  if (!host) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.host !== host || url.username || url.password) return null;
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!local && !url.hostname.endsWith(".ts.net")) return null;
    return `${local ? "http" : "https"}://${host}`;
  } catch {
    return null;
  }
}

function sessionToken(request: IncomingMessage): string | undefined {
  return request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

function setCookie(response: ServerResponse, token: string, origin: string): void {
  response.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_SECONDS}${origin.startsWith("https:") ? "; Secure" : ""}`,
  );
}

/** A loopback-only, paired gateway running on its own worker event loop. */
export async function startRemoteServer(options: {
  root: string;
  post: (message: RemoteToHost) => void;
  port?: number;
  pairingsFile?: string;
}) {
  const code = randomBytes(24).toString("base64url");
  const pairings = await RemotePairings.open(options.pairingsFile);
  const sessions = new Map<string, { seen: Set<string> }>();
  const clients = new Map<string, WebSocket>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: REMOTE_REQUEST_BYTES,
    perMessageDeflate: false,
  });
  let attempts = 0;
  let attemptWindow = 0;
  let closing = false;

  function session(request: IncomingMessage) {
    const token = sessionToken(request);
    if (!token || !pairings.has(token)) return undefined;
    let paired = sessions.get(token);
    if (!paired) {
      paired = { seen: new Set() };
      sessions.set(token, paired);
    }
    return paired;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Content-Security-Policy", CSP);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    const origin = requestOrigin(request);
    if (!origin) return reject(response, 403, "This host is not allowed.");
    if (request.url === "/pair" && request.method === "POST") {
      if (
        request.headers.origin !== origin ||
        request.headers["content-type"] !== "application/json"
      )
        return reject(response, 403, "Pair from this page only.");
      const now = Date.now();
      if (now - attemptWindow > 60_000) {
        attemptWindow = now;
        attempts = 0;
      }
      if (++attempts > 10)
        return reject(response, 429, "Too many attempts. Try again in a minute.");
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 1024)
          return reject(response, 413, "Pairing request too large.");
      }
      let entered: unknown;
      try {
        entered = (JSON.parse(body) as { code?: unknown }).code;
      } catch {
        return reject(response, 400, "Invalid pairing request.");
      }
      if (
        typeof entered !== "string" ||
        Buffer.byteLength(entered) !== Buffer.byteLength(code) ||
        !timingSafeEqual(Buffer.from(entered), Buffer.from(code))
      )
        return reject(response, 401, "That pairing code isn't correct.");
      const token = randomBytes(32).toString("base64url");
      if (!(await pairings.remember(token)))
        return reject(response, 429, "Too many paired browsers. Toggle remote access off and on.");
      setCookie(response, token, origin);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/session" && request.method === "GET") {
      const paired = Boolean(session(request));
      if (paired) setCookie(response, sessionToken(request)!, origin);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ paired }));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return reject(response, 405, "Method not allowed.");
    const pathname = new URL(request.url ?? "/", origin).pathname;
    const relative = pathname === "/" ? "remote.html" : pathname.slice(1);
    if (
      relative !== "remote.html" &&
      (!relative.startsWith("assets/") || !MIME[path.extname(relative)])
    )
      return reject(response, 404, "Not found.");
    const file = path.resolve(options.root, relative);
    if (!file.startsWith(`${path.resolve(options.root)}${path.sep}`))
      return reject(response, 404, "Not found.");
    const info = await stat(file).catch(() => null);
    if (!info?.isFile())
      return reject(response, 404, "Remote UI isn't built. Run pnpm build first.");
    response.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
    let servedFile = file;
    if (relative.startsWith("assets/")) {
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      response.setHeader("Vary", "Accept-Encoding");
      if (acceptsGzip(request.headers["accept-encoding"])) {
        const compressed = `${file}.gz`;
        if ((await stat(compressed).catch(() => null))?.isFile()) {
          servedFile = compressed;
          response.setHeader("Content-Encoding", "gzip");
        }
      }
    }
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(servedFile)
      .on("error", () => response.destroy())
      .pipe(response);
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reject(response, 500, "Remote request failed.");
      else response.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;
  server.on("upgrade", (request, socket, head) => {
    const origin = requestOrigin(request);
    const paired = session(request);
    if (
      closing ||
      !origin ||
      request.headers.origin !== origin ||
      request.url !== "/socket" ||
      !paired ||
      clients.size >= REMOTE_MAX_CLIENTS
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const clientId = randomBytes(16).toString("hex");
      clients.set(clientId, ws);
      let count = 0;
      let window = Date.now();
      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 20_000);
      heartbeat.unref();
      ws.on("pong", () => {
        alive = true;
      });
      ws.once("close", () => clearInterval(heartbeat));
      options.post({ type: "connect", clientId });
      ws.on("error", () => ws.terminate());
      ws.on("close", () => {
        clients.delete(clientId);
        options.post({ type: "disconnect", clientId });
      });
      ws.on("message", (data, binary) => {
        if (Date.now() - window > 1000) {
          window = Date.now();
          count = 0;
        }
        if (binary || ++count > 30) {
          ws.close(1008, "Too many requests");
          return;
        }
        let envelope: { id?: unknown; message?: unknown };
        try {
          envelope = JSON.parse(data.toString());
        } catch {
          ws.close(1008, "Invalid JSON");
          return;
        }
        if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
          ws.close(1008, "Invalid request");
          return;
        }
        const parsed = parseClientMessage(envelope.message);
        if (
          typeof envelope.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,64}$/.test(envelope.id) ||
          !parsed.ok
        ) {
          ws.close(1008, "Request not allowed");
          return;
        }
        if (!remoteRequestAllowed(parsed.message)) {
          ws.send(
            JSON.stringify({
              v,
              type: "remote-result",
              id: envelope.id,
              error: "This action is available only in Tondo on your Mac.",
            }),
          );
          return;
        }
        if (paired.seen.has(envelope.id)) {
          ws.send(
            JSON.stringify({
              v,
              type: "remote-result",
              id: envelope.id,
              error: "This action was already submitted. Check the thread before sending again.",
            }),
          );
          return;
        }
        // A bounded replay ledger: stop accepting rather than forget an accepted
        // action. This transport limit must not revoke remembered device pairing.
        if (paired.seen.size >= 4096) {
          ws.close(
            REMOTE_CLOSE_UNAVAILABLE,
            "Remote action limit reached. Restart Tondo to continue; this device stays paired.",
          );
          return;
        }
        paired.seen.add(envelope.id);
        options.post({ type: "request", clientId, id: envelope.id, message: parsed.message });
      });
    });
  });
  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? REMOTE_PORT, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolve();
    });
  });
  return {
    code,
    port: (server.address() as { port: number }).port,
    deliver(message: HostToRemote): void {
      const ws = clients.get(message.clientId);
      if (!ws) return;
      if (message.type === "close") {
        ws.close(REMOTE_CLOSE_UNAVAILABLE, message.reason.slice(0, 100));
        return;
      }
      const data = JSON.stringify(message.message);
      if (Buffer.byteLength(data) > REMOTE_FRAME_BYTES || ws.bufferedAmount > 1024 * 1024) {
        ws.close(REMOTE_CLOSE_UNAVAILABLE, "Remote output is too large; reopen the thread");
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(data, (error) => {
        if (error) ws.terminate();
        else options.post({ type: "delivered", clientId: message.clientId });
      });
    },
    async close(): Promise<void> {
      closing = true;
      sessions.clear();
      for (const ws of clients.values()) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
