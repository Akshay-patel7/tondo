import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from "electron";

// Matches the renderer's title bar: h-10 is 40px. The colors are the Warm
// theme's --background and --foreground from src/renderer/index.css, converted
// from oklch to sRGB hex: light oklch(98.4% 0.005 85) and oklch(26% 0.012 60),
// dark oklch(21.5% 0.006 60) and oklch(93% 0.01 80). Change them together.
const TITLE_BAR_HEIGHT = 40;
const MACOS_TRAFFIC_LIGHT_RADIUS = 7;
const THEME = {
  light: { background: "#fbfaf6", symbol: "#29231e" },
  dark: { background: "#1c1917", symbol: "#ebe7e1" },
};

function currentTheme() {
  return nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light;
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

  const applyTheme = () => {
    const theme = currentTheme();
    window.setBackgroundColor(theme.background);
    if (process.platform !== "darwin") {
      window.setTitleBarOverlay({ color: theme.background, symbolColor: theme.symbol });
    }
  };
  nativeTheme.on("updated", applyTheme);
  window.on("closed", () => nativeTheme.off("updated", applyTheme));

  window.loadURL(url).catch((error: unknown) => {
    console.error(`Tondo couldn't load ${url}:`, error);
  });
  return window;
}
