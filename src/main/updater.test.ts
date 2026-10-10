import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  const app = { isPackaged: true };
  const updater = Object.assign(new Emitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: null as unknown,
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  });
  const notifications: Array<
    InstanceType<typeof Emitter> & { options: { title: string; body: string }; show: () => void }
  > = [];
  let supported = true;
  class FakeNotification extends Emitter {
    static isSupported = () => supported;
    show = vi.fn();
    options: { title: string; body: string };
    constructor(options: { title: string; body: string }) {
      super();
      this.options = options;
      notifications.push(this);
    }
  }
  return {
    app,
    updater,
    notifications,
    Notification: FakeNotification,
    setSupported: (value: boolean) => (supported = value),
  };
});

vi.mock("electron", () => ({ app: mocks.app, Notification: mocks.Notification }));
// Node's import() of a CommonJS module puts module.exports on `default`, which updater.ts reads.
vi.mock("electron-updater", () => ({ default: { autoUpdater: mocks.updater } }));

import { startUpdater } from "./updater";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const logged = () => vi.mocked(console.log).mock.calls.map((call) => String(call[0]));

describe("startUpdater", () => {
  let resources: string;
  const originalResources = process.resourcesPath;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    resources = mkdtempSync(path.join(tmpdir(), "tondo-updater-"));
    writeFileSync(path.join(resources, "app-update.yml"), "provider: generic\n");
    Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
    delete process.env.TONDO_DISABLE_UPDATES;
    mocks.app.isPackaged = true;
    mocks.setSupported(true);
    mocks.notifications.length = 0;
    mocks.updater.removeAllListeners();
    mocks.updater.autoDownload = false;
    mocks.updater.autoInstallOnAppQuit = false;
    mocks.updater.checkForUpdates.mockReset().mockResolvedValue(null);
    mocks.updater.quitAndInstall.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.TONDO_DISABLE_UPDATES;
    Object.defineProperty(process, "resourcesPath", {
      value: originalResources,
      configurable: true,
    });
    rmSync(resources, { recursive: true, force: true });
  });

  it("stays off when the app isn't packaged", async () => {
    mocks.app.isPackaged = false;
    await startUpdater();
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatch(/^Tondo Updates: off/);
  });

  it("stays off when TONDO_DISABLE_UPDATES is 1", async () => {
    process.env.TONDO_DISABLE_UPDATES = "1";
    await startUpdater();
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatch(/^Tondo Updates: off/);
  });

  it("stays off when the build has no app-update.yml", async () => {
    rmSync(path.join(resources, "app-update.yml"));
    await startUpdater();
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatch(/^Tondo Updates: off/);
  });

  it("downloads and installs on quit, checks at once and again every 6 hours", async () => {
    await startUpdater();
    expect(mocks.updater.autoDownload).toBe(true);
    expect(mocks.updater.autoInstallOnAppQuit).toBe(true);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SIX_HOURS - 1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("logs the stable update lines", async () => {
    await startUpdater();
    mocks.updater.emit("checking-for-update");
    mocks.updater.emit("update-available", { version: "1.2.3" });
    mocks.updater.emit("update-not-available", { version: "1.2.3" });
    mocks.updater.emit("update-downloaded", { version: "1.2.3" });
    expect(logged()).toEqual([
      "Tondo Updates: checking",
      "Tondo Updates: 1.2.3 available",
      "Tondo Updates: up to date",
      "Tondo Updates: 1.2.3 downloaded",
    ]);
  });

  it("shows a notification when an update is downloaded", async () => {
    await startUpdater();
    mocks.updater.emit("update-downloaded", { version: "1.2.3" });
    expect(mocks.notifications).toHaveLength(1);
    expect(mocks.notifications[0]?.options).toEqual({
      title: "Tondo 1.2.3 is ready",
      body: "It installs when you quit Tondo. Click to restart now.",
    });
    expect(mocks.notifications[0]?.show).toHaveBeenCalledTimes(1);
  });

  it("skips the notification where the system has none", async () => {
    mocks.setSupported(false);
    await startUpdater();
    mocks.updater.emit("update-downloaded", { version: "1.2.3" });
    expect(mocks.notifications).toHaveLength(0);
  });

  it("restarts into the update when the notification is clicked", async () => {
    await startUpdater();
    mocks.updater.emit("update-downloaded", { version: "1.2.3" });
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    mocks.notifications[0]?.emit("click");
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("logs a rejected check and carries on", async () => {
    mocks.updater.checkForUpdates.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));
    await expect(startUpdater()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toMatch(/^Tondo Updates:/);
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("logs an error event and doesn't throw", async () => {
    await startUpdater();
    expect(() => mocks.updater.emit("error", new Error("boom"))).not.toThrow();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  // Unpackaged runs, pnpm perf among them, must not carry electron-updater in memory.
  it("loads electron-updater only once updates are on", async () => {
    let loads = 0;
    vi.doMock("electron-updater", () => {
      loads += 1;
      return { default: { autoUpdater: mocks.updater } };
    });
    vi.resetModules();
    const { startUpdater: fresh } = await import("./updater");
    mocks.app.isPackaged = false;
    await fresh();
    expect(loads).toBe(0);
    mocks.app.isPackaged = true;
    await fresh();
    expect(loads).toBe(1);
  });
});
