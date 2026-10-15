import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  session,
  shell,
  type OpenDialogOptions,
} from "electron";
import path from "node:path";
import { startHost, type Host } from "./host";
import { copyConsoleTo, lineWriter, LogFile } from "./logFile";
import { installAppMenu } from "./menu";
import { threadNotifications } from "./notifications";
import { piOptions, resolveUserDataDir } from "./profile";
import { reloadWhenRendererDies } from "./rendererRecovery";
import {
  denyPermissionsButClipboardWrite,
  handleAppProtocol,
  hardenWebContents,
  registerAppScheme,
} from "./security";
import { APP_URL, isSameOrigin } from "./securityPolicy";
import { startUpdater } from "./updater";
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
  console.log(`Tondo ${app.getVersion()} is running`);
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
  /** e2e replaces dialog.showOpenDialog, so it's looked up on every call. */
  const choosePiFile = async (): Promise<string | null> => {
    const options: OpenDialogOptions = { properties: ["openFile", "showHiddenFiles"] };
    const window = mainWindow?.isDestroyed() === false ? mainWindow : undefined;
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return canceled ? null : (filePaths[0] ?? null);
  };
  const chooseFiles = async (): Promise<string[]> => {
    const options: OpenDialogOptions = {
      title: "Attach local files",
      properties: ["openFile", "multiSelections", "showHiddenFiles"],
    };
    const window = mainWindow?.isDestroyed() === false ? mainWindow : undefined;
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return canceled ? [] : filePaths;
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

  /** The window, unless it's closed. */
  const openWindow = () => (mainWindow?.isDestroyed() === false ? mainWindow : undefined);
  /** Brings the window up, or opens a new one, and puts the thread on screen. */
  const showThread = (threadId: string) => {
    const window = openWindow();
    if (!window) {
      openMainWindow();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    host?.openThread(threadId);
  };
  const notify = threadNotifications(openWindow, showThread);

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
  /**
   * Closes the window and resolves once it's gone. The page saves its draft
   * as it unloads, so the host gets the draft before it's stopped.
   */
  const closeWindow = () =>
    new Promise<void>((resolve) => {
      const window = openWindow();
      if (!window) return resolve();
      // A hung page mustn't keep the app from quitting.
      const deadline = setTimeout(resolve, 5_000);
      window.once("closed", () => {
        clearTimeout(deadline);
        resolve();
      });
      window.close();
    });
  let quitting = false;
  app.on("before-quit", (event) => {
    const running = host;
    if (!running || hostStopped) return;
    // Quitting waits until pi and everything it started have stopped.
    event.preventDefault();
    // Closing the window quits again on Linux (window-all-closed); one stop is enough.
    if (quitting) return;
    quitting = true;
    running.quitting();
    closeWindow()
      .then(() => running.stop())
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
      installAppMenu({ isPackaged: app.isPackaged, platform: process.platform });
      denyPermissionsButClipboardWrite(session.defaultSession);
      const userData = app.getPath("userData");
      const { TONDO_PI_ARGS: piArgs, TONDO_POOL: pool } = process.env;
      const started = startHost({
        entry: path.join(__dirname, "host.js"),
        config: { userData, ...piOptions({ isPackaged: app.isPackaged, userData, piArgs, pool }) },
        chooseFolder,
        choosePiFile,
        chooseFiles,
        attention: notify,
        // The page is denied the clipboard, so /copy goes through main.
        copy: (text) => clipboard.writeText(text),
        reveal: (file) => shell.showItemInFolder(file),
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
      startUpdater().catch((error: unknown) => {
        console.error("Tondo Updates: couldn't start:", error);
      });
    })
    .catch((error: unknown) => {
      console.error("Tondo failed to start:", error);
      app.exit(1);
    });
}
