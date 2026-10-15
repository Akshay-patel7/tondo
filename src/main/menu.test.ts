import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { editingContextMenuTemplate, menuTemplate, type MenuOptions } from "./menu";

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

describe("editingContextMenuTemplate", () => {
  const params = {
    isEditable: true,
    misspelledWord: "mispelled",
    dictionarySuggestions: ["misspelled", "dispelled"],
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canDelete: true,
      canSelectAll: true,
      canEditRichly: false,
    },
  } satisfies Pick<
    ContextMenuParams,
    "isEditable" | "misspelledWord" | "dictionarySuggestions" | "editFlags"
  >;

  it("offers the browser's suggestions and replaces the clicked word", () => {
    const replace = vi.fn();
    const items = editingContextMenuTemplate(params, replace);
    expect(items.slice(0, 3)).toEqual([
      { label: "misspelled", click: expect.any(Function) },
      { label: "dispelled", click: expect.any(Function) },
      { type: "separator" },
    ]);
    const chooseSuggestion = items[1]!.click as () => void;
    chooseSuggestion();
    expect(replace).toHaveBeenCalledExactlyOnceWith("dispelled");
  });

  it("keeps editing actions when there are no spelling suggestions", () => {
    const items = editingContextMenuTemplate({ ...params, dictionarySuggestions: [] }, vi.fn());
    expect(items[0]).toEqual({ label: "No spelling suggestions", enabled: false });
    expect(walk(items)).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
  });

  it("shows only editing actions for correctly spelled text, using the browser's edit flags", () => {
    const items = editingContextMenuTemplate({ ...params, misspelledWord: "" }, vi.fn());
    expect(items[0]).toEqual({ role: "undo", enabled: true });
    expect(items[1]).toEqual({ role: "redo", enabled: false });
    expect(items.every((item) => !item.label)).toBe(true);
  });

  it("does not open a native menu outside editable text", () => {
    expect(editingContextMenuTemplate({ ...params, isEditable: false }, vi.fn())).toEqual([]);
  });
});

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
