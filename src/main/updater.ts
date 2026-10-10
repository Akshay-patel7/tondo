import { existsSync } from "node:fs";
import path from "node:path";
import { app, Notification } from "electron";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const PREFIX = "Tondo Updates:";

/** Kept so the notification isn't garbage collected before it's clicked. */
let readyNotification: Notification | undefined;

/** Why updates stay off, or undefined when they should run. */
function whyOff(): string | undefined {
  if (!app.isPackaged) return "off, this isn't a packaged app";
  if (process.env.TONDO_DISABLE_UPDATES === "1") return "off, TONDO_DISABLE_UPDATES is 1";
  if (!existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    return "off, this build has no app-update.yml";
  }
  return undefined;
}

/**
 * Checks for a new version at launch and every 6 hours, downloads it, and installs it on quit.
 * A failure is logged and never shown.
 */
export async function startUpdater(): Promise<void> {
  const reason = whyOff();
  if (reason) {
    console.log(`${PREFIX} ${reason}`);
    return;
  }
  // Loaded only once updates run, so unpackaged runs (tests, pnpm perf) never carry it in memory.
  // Node's import() finds a CommonJS module's named exports by static analysis, which misses
  // electron-updater's autoUpdater getter. The module object itself is always the default export.
  const updaterModule = (await import("electron-updater")) as unknown as {
    default: typeof import("electron-updater");
  };
  const { autoUpdater } = updaterModule.default;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => console.log(`${PREFIX} ${String(message)}`),
    warn: (message) => console.warn(`${PREFIX} ${String(message)}`),
    error: (message) => console.error(`${PREFIX} ${String(message)}`),
  };

  autoUpdater.on("checking-for-update", () => console.log(`${PREFIX} checking`));
  autoUpdater.on("update-available", (info) => console.log(`${PREFIX} ${info.version} available`));
  autoUpdater.on("update-not-available", () => console.log(`${PREFIX} up to date`));
  // An "error" event with no listener would throw.
  autoUpdater.on("error", (error) => console.error(`${PREFIX} failed:`, error));
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`${PREFIX} ${info.version} downloaded`);
    if (!Notification.isSupported()) return;
    readyNotification = new Notification({
      title: `Tondo ${info.version} is ready`,
      body: "It installs when you quit Tondo. Click to restart now.",
    });
    readyNotification.on("click", () => autoUpdater.quitAndInstall());
    readyNotification.show();
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      // Being offline is normal. A failed check is only worth a log line.
      console.error(`${PREFIX} check failed:`, error);
    });
  };
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}
