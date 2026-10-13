import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { panelSizes } from "./panelSizes";

const defaults = DEFAULT_SETTINGS.panelWidths;

describe("panelSizes", () => {
  it("keeps the existing default widths when the window has room", () => {
    expect(panelSizes(defaults, 1200, true, true)).toMatchObject({ sidebar: 256, changes: 432 });
    expect(panelSizes(defaults, 1200, true, false)).toMatchObject({ sidebar: 256, changes: 0 });
  });

  it("leaves 320px for the thread beside Changes in a narrow window", () => {
    expect(panelSizes(defaults, 600, false, true)).toMatchObject({
      sidebar: 0,
      changes: 280,
      changesMax: 280,
    });
  });

  it("temporarily caps a wide sidebar beside a wide Changes panel", () => {
    const widths = { sidebar: 480, changes: 800 };
    expect(panelSizes(widths, 1200, true, true)).toMatchObject({ sidebar: 200, changes: 680 });
    expect(panelSizes(widths, 1600, true, true)).toMatchObject({ sidebar: 480, changes: 800 });
    expect(widths).toEqual({ sidebar: 480, changes: 800 });
  });

  it("lets a hidden panel give its room back", () => {
    const widths = { sidebar: 480, changes: 800 };
    expect(panelSizes(widths, 1200, true, false)).toMatchObject({ sidebar: 480, changes: 0 });
    expect(panelSizes(widths, 1200, false, true)).toMatchObject({ sidebar: 0, changes: 800 });
  });

  it("fits every panel combination, including an explicit show in a tiny window", () => {
    for (const viewport of [420, 600, 840, 1000, 1200, 1600]) {
      for (const sidebarShown of [false, true]) {
        for (const changesShown of [false, true]) {
          for (const widths of [
            defaults,
            { sidebar: 200, changes: 280 },
            { sidebar: 480, changes: 800 },
          ]) {
            const sizes = panelSizes(widths, viewport, sidebarShown, changesShown);
            expect(sizes.sidebar).toBeGreaterThanOrEqual(0);
            expect(sizes.changes).toBeGreaterThanOrEqual(0);
            expect(sizes.sidebar + sizes.changes).toBeLessThanOrEqual(viewport);
            expect(sizes.sidebar).toBeLessThanOrEqual(sizes.sidebarMax);
            expect(sizes.changes).toBeLessThanOrEqual(sizes.changesMax);
            if (viewport >= 840)
              expect(viewport - sizes.sidebar - sizes.changes).toBeGreaterThanOrEqual(320);
          }
        }
      }
    }
  });
});
