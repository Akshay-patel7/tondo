import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from "electron";
import type { PaletteSetting } from "../shared/settings";

// Matches the renderer's title bar: h-10 is 40px. Colors are --background and
// --foreground from index.css converted from OKLCH to sRGB. Change them together.
const TITLE_BAR_HEIGHT = 40;
const MACOS_TRAFFIC_LIGHT_RADIUS = 7;
const THEME = {
  default: {
    light: { background: "#fbfaf6", symbol: "#29231e" },
    dark: { background: "#1c1917", symbol: "#ebe7e1" },
  },
  slate: {
    light: { background: "#f8fafc", symbol: "#1e242f" },
    dark: { background: "#161a1f", symbol: "#e4e8ed" },
  },
  ocean: {
    light: { background: "#f6fbfc", symbol: "#1a262d" },
    dark: { background: "#141a1e", symbol: "#e1eaec" },
  },
  rose: {
    light: { background: "#fcf9fa", symbol: "#2b2124" },
    dark: { background: "#1d181a", symbol: "#eee5e8" },
  },
} as const;

let palette: PaletteSetting = "default";

function currentTheme() {
  return nativeTheme.shouldUseDarkColors ? THEME[palette].dark : THEME[palette].light;
}

function applyWindowTheme(window: BrowserWindow): void {
  const theme = currentTheme();
  window.setBackgroundColor(theme.background);
  if (process.platform !== "darwin") {
    window.setTitleBarOverlay({ color: theme.background, symbolColor: theme.symbol });
  }
}

/** Keeps existing windows and subsequently opened ones in the saved palette. */
export function setWindowPalette(next: PaletteSetting): void {
  if (next === palette) return;
  palette = next;
  for (const window of BrowserWindow.getAllWindows()) applyWindowTheme(window);
}

function titleBarOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: TITLE_BAR_HEIGHT / 2 - MACOS_TRAFFIC_LIGHT_RADIUS },
    };
  }
  const theme = currentTheme();
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: theme.background,
      symbolColor: theme.symbol,
      height: TITLE_BAR_HEIGHT,
    },
  };
}

export function createMainWindow(url: string, preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    title: "Tondo",
    width: 1200,
    height: 800,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: currentTheme().background,
    ...titleBarOptions(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  const applyTheme = () => applyWindowTheme(window);
  nativeTheme.on("updated", applyTheme);
  window.on("closed", () => nativeTheme.off("updated", applyTheme));

  window.loadURL(url).catch((error: unknown) => {
    console.error(`Tondo couldn't load ${url}:`, error);
  });
  return window;
}
