import { EventEmitter, once } from "node:events";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION as v } from "../shared/protocol";
import { REMOTE_CLOSE_UNAVAILABLE, REMOTE_FRAME_BYTES, type RemoteToHost } from "../shared/remote";
import { startRemoteServer } from "./remoteServer";

let root: string;
let server: Awaited<ReturnType<typeof startRemoteServer>>;
let base: string;
let events: EventEmitter;
let posted: RemoteToHost[];

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "tondo-remote-server-"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "remote.html"), "<html>Remote UI</html>");
  writeFileSync(path.join(root, "index.html"), "DESKTOP ONLY");
  writeFileSync(path.join(root, "assets/test.js"), "export const test = 1;");
  writeFileSync(path.join(root, "assets/test.js.gz"), gzipSync("export const test = 1;"));
  writeFileSync(path.join(root, "assets/test.js.map"), "PRIVATE SOURCE MAP");
  events = new EventEmitter();
  posted = [];
  server = await startRemoteServer({
    root,
    port: 0,
    pairingsFile: path.join(root, "pairings.json"),
    post: (message) => {
      posted.push(message);
      events.emit(message.type, message);
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

function rawRequest(
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      base + (body ? "/pair" : "/"),
      { method: body ? "POST" : "GET", headers },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolve({ status: response.statusCode!, headers: response.headers }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function pair(code = server.code, origin = base): Promise<Response> {
  return fetch(`${base}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ code }),
  });
}
async function cookie(): Promise<string> {
  const response = await pair();
  expect(response.status).toBe(204);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}
async function connect(paired: string): Promise<{ ws: WebSocket; clientId: string }> {
  const connected = once(events, "connect");
  const ws = new WebSocket(base.replace("http:", "ws:") + "/socket", {
    origin: base,
    headers: { Cookie: paired },
  });
  await once(ws, "open");
  const [message] = (await connected) as [Extract<RemoteToHost, { type: "connect" }>];
  return { ws, clientId: message.clientId };
}
async function rejectedUpgrade(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/socket", { headers });
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
      ws.terminate();
    });
    ws.once("error", (error) => {
      if (!error.message.includes("closed before")) reject(error);
    });
    ws.once("open", () => {
      ws.terminate();
      reject(new Error("Unexpected authenticated connection"));
    });
  });
}

describe("paired loopback gateway", () => {
  it("serves only the built remote UI and public assets, with strict browser headers", async () => {
    const response = await fetch(base);
    expect(await response.text()).toContain("Remote UI");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/assets/test.js`)).status).toBe(200);
    const blocked = await Promise.all(
      ["/index.html", "/assets/test.js.map", "/settings.json", "/assets/../../package.json"].map(
        (target) => fetch(base + target),
      ),
    );
    expect(blocked.map((entry) => entry.status)).toEqual([404, 404, 404, 404]);
    expect((await rawRequest({ Host: "attacker.example" })).status).toBe(403);
  });

  it("serves build-time compressed assets without runtime compression and respects gzip opt-out", async () => {
    const compressed = await fetch(`${base}/assets/test.js`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    expect(await compressed.text()).toBe("export const test = 1;");
    const plain = await fetch(`${base}/assets/test.js`, {
      headers: { "Accept-Encoding": "gzip;q=0" },
    });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe("export const test = 1;");
    expect((await fetch(`${base}/assets/test.js.gz`)).status).toBe(404);
  });

  it("requires pairing, checks origins, and uses an HTTP-only same-site cookie", async () => {
    expect(await (await fetch(`${base}/session`)).json()).toEqual({ paired: false });
    expect((await pair("wrong")).status).toBe(401);
    expect((await pair(server.code, "https://attacker.example")).status).toBe(403);
    const response = await pair();
    const set = response.headers.get("set-cookie")!;
    expect(set).toContain("HttpOnly; SameSite=Strict");
    expect(set).not.toContain(server.code);
    expect(
      await (await fetch(`${base}/session`, { headers: { Cookie: set.split(";", 1)[0]! } })).json(),
    ).toEqual({ paired: true });
    expect(await rejectedUpgrade({ Origin: base })).toBe(403);
    expect(await rejectedUpgrade({ Origin: "https://attacker.example", Cookie: set })).toBe(403);
    const secure = await rawRequest(
      {
        Host: "mac.tail-test.ts.net",
        Origin: "https://mac.tail-test.ts.net",
        "Content-Type": "application/json",
      },
      JSON.stringify({ code: server.code }),
    );
    expect(secure.status).toBe(204);
    expect(secure.headers["set-cookie"]?.[0]).toContain("; Secure");
  });

  it("keeps devices paired across gateway restarts and renews persistent cookies", async () => {
    const paired = await cookie();
    const oldCode = server.code;
    await server.close();
    server = await startRemoteServer({
      root,
      port: 0,
      pairingsFile: path.join(root, "pairings.json"),
      post: () => {},
    });
    base = `http://127.0.0.1:${server.port}`;
    expect(server.code).not.toBe(oldCode);
    const response = await fetch(`${base}/session`, { headers: { Cookie: paired } });
    expect(await response.json()).toEqual({ paired: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=34560000");
    expect((await pair(oldCode)).status).toBe(401);
    await server.close();
    rmSync(path.join(root, "pairings.json"));
    server = await startRemoteServer({
      root,
      port: 0,
      pairingsFile: path.join(root, "pairings.json"),
      post: () => {},
    });
    base = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(`${base}/session`, { headers: { Cookie: paired } })).json()).toEqual({
      paired: false,
    });
    expect(await rejectedUpgrade({ Origin: base, Cookie: paired })).toBe(403);
  });

  it("rejects malformed and oversized pairing bodies and rate-limits guessing", async () => {
    expect(
      (
        await fetch(`${base}/pair`, {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: "null",
        })
      ).status,
    ).toBe(400);
    expect((await pair("x".repeat(1500))).status).toBe(413);
    await Promise.all(Array.from({ length: 8 }, () => pair("wrong")));
    expect((await pair()).status).toBe(429);
  });

  it("does not replay a duplicate action, even across socket reconnections", async () => {
    const paired = await cookie();
    const first = await connect(paired);
    const action = JSON.stringify({
      id: "same-action",
      message: { v, type: "prompt", threadId: "thread", text: "hello", streamingBehavior: "steer" },
    });
    const accepted = once(events, "request");
    first.ws.send(action);
    await accepted;
    const closed = once(first.ws, "close");
    first.ws.close();
    await closed;
    const second = await connect(paired);
    second.ws.send(action);
    const barrier = once(events, "request");
    second.ws.send(JSON.stringify({ id: "barrier", message: { v, type: "ping", id: 1 } }));
    const [message] = await barrier;
    expect(message.id).toBe("barrier");
    expect(
      posted.filter((entry) => entry.type === "request" && entry.id === "same-action"),
    ).toHaveLength(1);
  });

  it("keeps device pairing when the bounded replay ledger requires a gateway restart", async () => {
    const paired = await cookie();
    const { ws } = await connect(paired);
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 100));
    try {
      const filled = new Promise<void>((resolve) => {
        let count = 0;
        const record = () => {
          if (++count === 4096) {
            events.off("request", record);
            resolve();
          }
        };
        events.on("request", record);
      });
      for (let id = 0; id < 4096; id++)
        ws.send(JSON.stringify({ id: `request-${id}`, message: { v, type: "ping", id } }));
      await filled;
      const closed = once(ws, "close");
      ws.send(JSON.stringify({ id: "limit", message: { v, type: "ping", id: 4096 } }));
      expect((await closed)[0]).toBe(REMOTE_CLOSE_UNAVAILABLE);
      expect(
        await (await fetch(`${base}/session`, { headers: { Cookie: paired } })).json(),
      ).toEqual({ paired: true });
    } finally {
      clock.mockRestore();
    }
  });

  it.each([null, [], { id: "bad", message: { v: 0, type: "ping", id: 1 } }])(
    "closes malformed requests without crashing: %j",
    async (message) => {
      const { ws } = await connect(await cookie());
      const closed = once(ws, "close");
      ws.send(JSON.stringify(message));
      expect((await closed)[0]).toBe(1008);
      expect((await fetch(base)).status).toBe(200);
    },
  );

  it("denies desktop-only actions without forwarding them or breaking the phone connection", async () => {
    const { ws } = await connect(await cookie());
    const denied = once(ws, "message");
    ws.send(
      JSON.stringify({
        id: "settings",
        message: { v, type: "set-settings", patch: { remoteAccess: false } },
      }),
    );
    expect(JSON.parse((await denied)[0].toString())).toMatchObject({
      type: "remote-result",
      id: "settings",
      error: expect.any(String),
    });
    const barrier = once(events, "request");
    ws.send(JSON.stringify({ id: "barrier", message: { v, type: "ping", id: 1 } }));
    expect((await barrier)[0].id).toBe("barrier");
    expect(posted.filter((message) => message.type === "request")).toHaveLength(1);
  });

  it("acknowledges delivered frames and disconnects oversized output instead of buffering indefinitely", async () => {
    const { ws, clientId } = await connect(await cookie());
    const received = once(ws, "message");
    const delivered = once(events, "delivered");
    server.deliver({ type: "message", clientId, message: { v, type: "error", message: "hello" } });
    expect(JSON.parse((await received)[0].toString()).message).toBe("hello");
    await delivered;
    const closed = once(ws, "close");
    server.deliver({
      type: "message",
      clientId,
      message: { v, type: "error", message: "x".repeat(REMOTE_FRAME_BYTES) },
    });
    expect((await closed)[0]).toBe(REMOTE_CLOSE_UNAVAILABLE);
  });
});
