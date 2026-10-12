import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from "electron";
import type { PaletteSetting } from "../shared/settings";

// Matches the renderer's title bar: h-11 is 44px. Colors are --background and
// --foreground from index.css converted from OKLCH to sRGB. Change them together.
const TITLE_BAR_HEIGHT = 44;
const MACOS_TRAFFIC_LIGHT_RADIUS = 7;
const THEME = {
  default: {
    light: { background: "#fbfaf6", symbol: "#29231e" },
    dark: { background: "#11100f", symbol: "#edebe7" },
  },
  slate: {
    light: { background: "#f8fafc", symbol: "#1e242f" },
    dark: { background: "#0e1116", symbol: "#e8ebf1" },
  },
  ocean: {
    light: { background: "#f6fbfc", symbol: "#1a262d" },
    dark: { background: "#0b1115", symbol: "#e4edf0" },
  },
  rose: {
    light: { background: "#fcf9fa", symbol: "#2b2124" },
    dark: { background: "#140f11", symbol: "#f1e8eb" },
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
