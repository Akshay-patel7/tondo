import { Menu, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";

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

/** Native text editing and spelling suggestions, without replacing app-owned menus. */
export function editingContextMenuTemplate(
  {
    isEditable,
    misspelledWord,
    dictionarySuggestions,
    editFlags,
  }: Pick<
    ContextMenuParams,
    "isEditable" | "misspelledWord" | "dictionarySuggestions" | "editFlags"
  >,
  replaceMisspelling: (word: string) => void,
): MenuItemConstructorOptions[] {
  if (!isEditable) return [];

  const items: MenuItemConstructorOptions[] = [];
  if (misspelledWord) {
    for (const suggestion of dictionarySuggestions) {
      items.push({ label: suggestion, click: () => replaceMisspelling(suggestion) });
    }
    if (dictionarySuggestions.length === 0) {
      items.push({ label: "No spelling suggestions", enabled: false });
    }
    items.push({ type: "separator" });
  }
  items.push(
    { role: "undo", enabled: editFlags.canUndo },
    { role: "redo", enabled: editFlags.canRedo },
    { type: "separator" },
    { role: "cut", enabled: editFlags.canCut },
    { role: "copy", enabled: editFlags.canCopy },
    { role: "paste", enabled: editFlags.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: editFlags.canSelectAll },
  );
  return items;
}

export function installAppMenu(options: MenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(options)));
}
