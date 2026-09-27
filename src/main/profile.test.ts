import path from "node:path";
import { describe, expect, it } from "vitest";
import { piOptions, resolveUserDataDir } from "./profile";

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

describe("piOptions", () => {
  const userData = path.resolve("/work/tondo/.dev/userData");
  const piArgs = JSON.stringify(["--offline", "-e", "faux-ext.ts"]);

  it("keeps unpackaged runs' pi files in the profile, with TONDO_PI_ARGS added", () => {
    expect(piOptions({ isPackaged: false, userData, piArgs })).toEqual({
      piAgentDir: path.join(userData, "pi-agent"),
      piArgs: ["--offline", "-e", "faux-ext.ts"],
    });
    expect(piOptions({ isPackaged: false, userData, piArgs: undefined }).piArgs).toEqual([]);
    expect(piOptions({ isPackaged: false, userData, piArgs: "" }).piArgs).toEqual([]);
  });

  it("runs pi as you set it up in a packaged app, ignoring TONDO_PI_ARGS", () => {
    expect(piOptions({ isPackaged: true, userData, piArgs })).toEqual({ piArgs: [] });
    expect(piOptions({ isPackaged: true, userData, piArgs: "not json" })).toEqual({ piArgs: [] });
  });

  it.each(["--offline", '"--offline"', '["-e", 5]', '{"args": []}'])(
    "fails on a TONDO_PI_ARGS of %s",
    (value) => {
      expect(() => piOptions({ isPackaged: false, userData, piArgs: value })).toThrow(
        `TONDO_PI_ARGS must be a JSON array of strings, not ${value}`,
      );
    },
  );
});
