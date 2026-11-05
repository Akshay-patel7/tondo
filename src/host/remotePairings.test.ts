import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RemotePairings } from "./remotePairings";

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "tondo-pairings-"));
  file = path.join(root, "remote-pairings.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const token = () => randomBytes(32).toString("base64url");

it("remembers a device across restarts without storing its bearer token", async () => {
  const store = await RemotePairings.open(file);
  const device = token();
  expect(store.has(device)).toBe(false);
  expect(await store.remember(device)).toBe(true);
  expect((await RemotePairings.open(file)).has(device)).toBe(true);
  expect(readFileSync(file, "utf8")).not.toContain(device);
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(store.has(token())).toBe(false);
  expect(store.has("invalid")).toBe(false);
});

it("serializes concurrent pairing attempts and enforces the persisted device limit", async () => {
  const store = await RemotePairings.open(file);
  const devices = Array.from({ length: 20 }, token);
  const results = await Promise.all(devices.map((device) => store.remember(device)));
  expect(results.filter(Boolean)).toHaveLength(16);
  const restored = await RemotePairings.open(file);
  expect(devices.filter((device) => restored.has(device))).toHaveLength(16);
  expect(await restored.remember(token())).toBe(false);
});

it("forgets all devices when the pairing file is removed", async () => {
  const store = await RemotePairings.open(file);
  const device = token();
  await store.remember(device);
  rmSync(file);
  expect((await RemotePairings.open(file)).has(device)).toBe(false);
});

it.each(["null", "{}", '{"version":1,"tokens":["raw-secret"]}', "x".repeat(4097)])(
  "fails closed on invalid or oversized storage",
  async (content) => {
    writeFileSync(file, content);
    await expect(RemotePairings.open(file)).rejects.toThrow();
  },
);

it("never authorizes a device when persistence fails, and allows a later retry", async () => {
  const store = await RemotePairings.open(path.join(root, "missing", "pairings.json"));
  const device = token();
  await expect(store.remember(device)).rejects.toThrow();
  expect(store.has(device)).toBe(false);
  await expect(store.remember(device)).rejects.toThrow();
});
