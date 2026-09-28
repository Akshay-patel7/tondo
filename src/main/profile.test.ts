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

  const pool = JSON.stringify({ maxLive: 1, idleMs: 0 });

  it("keeps unpackaged runs' pi files in the profile, with TONDO_PI_ARGS and TONDO_POOL", () => {
    expect(piOptions({ isPackaged: false, userData, piArgs, pool })).toEqual({
      piAgentDir: path.join(userData, "pi-agent"),
      piArgs: ["--offline", "-e", "faux-ext.ts"],
      pool: { maxLive: 1, idleMs: 0 },
    });
    expect(piOptions({ isPackaged: false, userData, piArgs: undefined, pool: undefined })).toEqual({
      piAgentDir: path.join(userData, "pi-agent"),
      piArgs: [],
    });
    expect(piOptions({ isPackaged: false, userData, piArgs: "", pool: "" })).toEqual({
      piAgentDir: path.join(userData, "pi-agent"),
      piArgs: [],
    });
  });

  it("runs pi as you set it up in a packaged app, ignoring TONDO_PI_ARGS and TONDO_POOL", () => {
    expect(piOptions({ isPackaged: true, userData, piArgs, pool })).toEqual({ piArgs: [] });
    expect(piOptions({ isPackaged: true, userData, piArgs: "not json", pool: "[]" })).toEqual({
      piArgs: [],
    });
  });

  it.each(["--offline", '"--offline"', '["-e", 5]', '{"args": []}'])(
    "fails on a TONDO_PI_ARGS of %s",
    (value) => {
      expect(() =>
        piOptions({ isPackaged: false, userData, piArgs: value, pool: undefined }),
      ).toThrow(`TONDO_PI_ARGS must be a JSON array of strings, not ${value}`);
    },
  );

  it.each(["4", "[1]", "null", '{"maxLive": -1}', '{"maxLive": 1.5}', '{"size": 4}', "{"])(
    "fails on a TONDO_POOL of %s",
    (value) => {
      expect(() =>
        piOptions({ isPackaged: false, userData, piArgs: undefined, pool: value }),
      ).toThrow(
        `TONDO_POOL must be a JSON object with whole numbers for maxLive and idleMs, not ${value}`,
      );
    },
  );
});
