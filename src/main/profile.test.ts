import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUserDataDir } from "./profile";

describe("resolveUserDataDir", () => {
  const appPath = path.resolve("/work/tondo");

  it("keeps unpackaged runs in the repo's .dev folder", () => {
    expect(resolveUserDataDir({ override: undefined, isPackaged: false, appPath })).toBe(
      path.join(appPath, ".dev", "userData"),
    );
  });

  it("leaves a packaged app on Electron's default", () => {
    expect(resolveUserDataDir({ override: undefined, isPackaged: true, appPath })).toBeUndefined();
  });

  it("prefers TONDO_USER_DATA_DIR, resolved to an absolute path", () => {
    for (const isPackaged of [false, true]) {
      expect(resolveUserDataDir({ override: "tmp/profile", isPackaged, appPath })).toBe(
        path.resolve("tmp/profile"),
      );
    }
  });

  it("ignores an empty TONDO_USER_DATA_DIR", () => {
    expect(resolveUserDataDir({ override: "", isPackaged: false, appPath })).toBe(
      path.join(appPath, ".dev", "userData"),
    );
  });
});
