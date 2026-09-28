import { app, BrowserWindow, dialog, session, type OpenDialogOptions } from "electron";
import path from "node:path";
import { startHost, type Host } from "./host";
import { copyConsoleTo, lineWriter, LogFile } from "./logFile";
import { piOptions, resolveUserDataDir } from "./profile";
import { reloadWhenRendererDies } from "./rendererRecovery";
import {
  denyAllPermissions,
  handleAppProtocol,
  hardenWebContents,
  registerAppScheme,
} from "./security";
import { APP_URL, isSameOrigin } from "./securityPolicy";
import { createMainWindow } from "./window";

// The profile decides the single-instance lock, so it's set before anything else.
const userDataDir = resolveUserDataDir({
  override: process.env.TONDO_USER_DATA_DIR,
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
});
if (userDataDir) app.setPath("userData", userDataDir);

// electron-vite sets this for `pnpm dev`. A packaged app never trusts it.
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const rendererUrl = devServerUrl ?? APP_URL;

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Only the instance holding the lock writes the logs.
  const logs = path.join(app.getPath("userData"), "logs");
  copyConsoleTo(new LogFile(path.join(logs, "main.log")));
  const hostLog = new LogFile(path.join(logs, "host.log"));
  const hostOutput = {
    stdout: lineWriter(hostLog, "stdout"),
    stderr: lineWriter(hostLog, "stderr"),
  };

  let mainWindow: BrowserWindow | undefined;
  let host: Host | undefined;
  /** e2e replaces dialog.showOpenDialog, so it's looked up on every call. */
  const chooseFolder = async (): Promise<string | null> => {
    const options: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
    const window = mainWindow?.isDestroyed() === false ? mainWindow : undefined;
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return canceled ? null : (filePaths[0] ?? null);
  };
  /** Set once the host and every process group it reported are gone. */
  let hostStopped = false;
  const openMainWindow = () => {
    const window = createMainWindow(rendererUrl, path.join(__dirname, "../preload/index.js"));
    mainWindow = window;
    reloadWhenRendererDies(window.webContents);
    // Every page load gets its own port to the host.
    window.webContents.on("dom-ready", () => host?.connect(window.webContents));
  };

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    hardenWebContents(contents, (url) => isSameOrigin(url, rendererUrl));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
  app.on("before-quit", (event) => {
    if (!host || hostStopped) return;
    // Quitting waits until pi and everything it started have stopped.
    event.preventDefault();
    host
      .stop()
      .catch((error: unknown) => console.error("Tondo couldn't stop its host:", error))
      .finally(() => {
        hostStopped = true;
        app.quit();
      });
  });

  app
    .whenReady()
    .then(() => {
      handleAppProtocol(path.join(__dirname, "../renderer"));
      denyAllPermissions(session.defaultSession);
      const userData = app.getPath("userData");
      const piArgs = process.env.TONDO_PI_ARGS;
      const started = startHost({
        entry: path.join(__dirname, "host.js"),
        config: { userData, ...piOptions({ isPackaged: app.isPackaged, userData, piArgs }) },
        chooseFolder,
        onOutput: (stream, text) => {
          hostOutput[stream](text);
          process[stream].write(text);
        },
      });
      host = started;
      // Tests check that pi's process groups are gone. A packaged app has no such door.
      if (!app.isPackaged) {
        Object.assign(globalThis, {
          tondoTest: { processGroups: () => started.processGroups },
        });
      }
      // perf launches Tondo with gc() exposed and collects the host's garbage too.
      if (globalThis.gc) {
        Object.assign(globalThis, { tondoCollectHostGarbage: () => started.collectGarbage() });
      }
      openMainWindow();
    })
    .catch((error: unknown) => {
      console.error("Tondo failed to start:", error);
      app.exit(1);
    });
}
