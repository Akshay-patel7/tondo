import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { resolveUserDataDir } from "./profile";
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
  let mainWindow: BrowserWindow | undefined;
  const openMainWindow = () => {
    mainWindow = createMainWindow(rendererUrl, path.join(__dirname, "../preload/index.js"));
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

  app
    .whenReady()
    .then(() => {
      handleAppProtocol(path.join(__dirname, "../renderer"));
      denyAllPermissions(session.defaultSession);
      openMainWindow();
    })
    .catch((error: unknown) => {
      console.error("Tondo failed to start:", error);
      app.exit(1);
    });
}
