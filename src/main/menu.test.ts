import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { menuTemplate, type MenuOptions } from "./menu";

function walk(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? walk(item.submenu) : []),
  ]);
}

function roles(options: MenuOptions): string[] {
  return walk(menuTemplate(options));
}

const DEVELOP = ["reload", "forceReload", "toggleDevTools"];

describe("menuTemplate", () => {
  it("has no reload or DevTools in a packaged app", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const found = roles({ isPackaged: true, platform });
      expect(found.filter((role) => DEVELOP.includes(role))).toEqual([]);
    }
  });

  it("keeps the app, edit and window menus on macOS", () => {
    expect(roles({ isPackaged: true, platform: "darwin" })).toEqual(
      expect.arrayContaining(["appMenu", "editMenu", "windowMenu"]),
    );
  });

  it("keeps reload and DevTools in unpackaged runs", () => {
    expect(roles({ isPackaged: false, platform: "darwin" })).toEqual(
      expect.arrayContaining(DEVELOP),
    );
  });

  it("has no app menu outside macOS", () => {
    expect(roles({ isPackaged: true, platform: "linux" })).not.toContain("appMenu");
  });
});
