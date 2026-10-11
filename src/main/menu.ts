import { Menu, type MenuItemConstructorOptions } from "electron";

export interface MenuOptions {
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

/**
 * The application menu. Edit keeps text shortcuts like copy, paste, undo and
 * select all working on macOS. Reload and DevTools exist only in unpackaged
 * runs, so a packaged app can't open DevTools or reload away its state.
 */
export function menuTemplate({ isPackaged, platform }: MenuOptions): MenuItemConstructorOptions[] {
  const isMac = platform === "darwin";
  const develop: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ];
  return [
    ...(isMac ? [{ role: "appMenu" } as const] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...develop,
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
}

export function installAppMenu(options: MenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(options)));
}
