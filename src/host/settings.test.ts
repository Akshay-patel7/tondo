import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/settings";
import {
  readSettings,
  readSettingsLeniently,
  saveTrustAnswer,
  updateSettings,
} from "./settings";

const DEFAULTS = { ...DEFAULT_SETTINGS, projectTrust: {} };

let dir: string;
let file: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-settings-")));
  file = path.join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readSettings", () => {
  it("holds the defaults when the file doesn't exist", () => {
    expect(readSettings(file)).toEqual({
      piPath: null,
      theme: "system",
      pool: { maxLive: 4, idleMinutes: 10 },
      shortcuts: {},
      projectTrust: {},
    });
  });

  it("reads every setting, and ignores keys it doesn't know", () => {
    writeFileSync(
      file,
      JSON.stringify({
        piPath: "/opt/pi/bin/pi",
        theme: "dark",
        pool: { maxLive: 12, idleMinutes: 240 },
        shortcuts: { palette: "mod+shift+p", settings: null },
        projectTrust: { "/work/a": true, "/work/b": false },
        later: 1,
      }),
    );
    expect(readSettings(file)).toEqual({
      piPath: "/opt/pi/bin/pi",
      theme: "dark",
      pool: { maxLive: 12, idleMinutes: 240 },
      shortcuts: { palette: "mod+shift+p", settings: null },
      projectTrust: { "/work/a": true, "/work/b": false },
    });
  });

  it("fills in a pool setting the file leaves out", () => {
    writeFileSync(file, JSON.stringify({ pool: { maxLive: 1 } }));
    expect(readSettings(file).pool).toEqual({ maxLive: 1, idleMinutes: 10 });
  });

  it.each([
    ["{", "isn't valid JSON: "],
    ["[]", "isn't a JSON object"],
    ['{"piPath":"bin/pi"}', `has a piPath that isn't an absolute path: "bin/pi"`],
    ['{"piPath":5}', "has a piPath that isn't an absolute path: 5"],
    [
      '{"projectTrust":{"/work/a":"yes"}}',
      "has a projectTrust that isn't an object of true and false answers",
    ],
    ['{"projectTrust":[]}', "has a projectTrust that isn't an object of true and false answers"],
    ['{"theme":"blue"}', `has a theme that isn't system, light or dark: "blue"`],
    ['{"pool":4}', "has a pool that isn't an object"],
    ['{"pool":{"maxLive":0}}', "has a pool.maxLive that isn't a whole number from 1 to 12: 0"],
    ['{"pool":{"maxLive":13}}', "has a pool.maxLive that isn't a whole number from 1 to 12: 13"],
    ['{"pool":{"maxLive":2.5}}', "has a pool.maxLive that isn't a whole number from 1 to 12: 2.5"],
    [
      '{"pool":{"idleMinutes":0}}',
      "has a pool.idleMinutes that isn't a whole number from 1 to 240: 0",
    ],
    [
      '{"pool":{"idleMinutes":241}}',
      "has a pool.idleMinutes that isn't a whole number from 1 to 240: 241",
    ],
    ['{"shortcuts":[]}', "has shortcuts that aren't an object"],
    ['{"shortcuts":{"palette":"mod+"}}', `has a palette shortcut that isn't one: "mod+"`],
    ['{"shortcuts":{"palette":5}}', "has a palette shortcut that isn't one: 5"],
  ])("names the file and the problem for %s", (content, problem) => {
    writeFileSync(file, content);
    expect(() => readSettings(file)).toThrow(`Tondo's settings file ${file} ${problem}`);
  });

  it("reads a file that starts with a byte order mark", () => {
    writeFileSync(file, `\uFEFF${JSON.stringify({ theme: "dark" })}`);
    expect(readSettings(file).theme).toBe("dark");
  });

  it("leaves out a shortcut for a command this version doesn't know, and reads the rest", () => {
    writeFileSync(
      file,
      JSON.stringify({
        theme: "dark",
        shortcuts: { "toggle-terminal": "mod+j", later: "not a chord", palette: "mod+p" },
      }),
    );
    expect(readSettings(file)).toEqual({
      ...DEFAULTS,
      theme: "dark",
      shortcuts: { palette: "mod+p" },
    });
  });

  it("passes on errors other than a missing file", () => {
    mkdirSync(file);
    expect(() => readSettings(file)).toThrow(/EISDIR/);
  });
});

describe("readSettingsLeniently", () => {
  it("reads a valid file with no problem", () => {
    writeFileSync(file, JSON.stringify({ theme: "light", projectTrust: { "/work/a": true } }));
    expect(readSettingsLeniently(file)).toEqual({
      settings: { ...DEFAULTS, theme: "light", projectTrust: { "/work/a": true } },
      problem: null,
    });
  });

  it("gives each setting the file gets wrong its default, keeps the rest, and names the first problem", () => {
    writeFileSync(
      file,
      JSON.stringify({
        piPath: "/opt/pi/bin/pi",
        theme: "sepia",
        pool: { maxLive: 9999, idleMinutes: 30 },
        shortcuts: { palette: "mod+", settings: "mod+j" },
        projectTrust: { "/work/a": true, "/work/b": "yes" },
      }),
    );
    expect(readSettingsLeniently(file)).toEqual({
      settings: {
        piPath: "/opt/pi/bin/pi",
        theme: "system",
        pool: { maxLive: 4, idleMinutes: 30 },
        shortcuts: { settings: "mod+j" },
        projectTrust: { "/work/a": true },
      },
      problem: `Tondo's settings file ${file} has a projectTrust that isn't an object of true and false answers`,
    });
  });

  it("holds the defaults when the file isn't JSON, and says so", () => {
    writeFileSync(file, "{");
    const { settings, problem } = readSettingsLeniently(file);
    expect(settings).toEqual(DEFAULTS);
    expect(problem).toContain(`Tondo's settings file ${file} isn't valid JSON: `);
  });
});
describe("updateSettings", () => {
  it("keeps keys it doesn't know and your trust answers", () => {
    writeFileSync(
      file,
      JSON.stringify({ projectTrust: { "/work/a": true }, later: { kept: 1 }, pool: { extra: 2 } }),
    );

    const settings = updateSettings(file, { theme: "light", pool: { maxLive: 2 } });

    expect(settings).toEqual({
      ...DEFAULTS,
      theme: "light",
      pool: { maxLive: 2, idleMinutes: 10 },
      projectTrust: { "/work/a": true },
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      projectTrust: { "/work/a": true },
      later: { kept: 1 },
      pool: { extra: 2, maxLive: 2 },
      theme: "light",
    });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("saves a shortcut in canonical form, disables one with null, and restores the default", () => {
    updateSettings(file, { shortcuts: { palette: "shift+mod+p", settings: null } });
    expect(readSettings(file).shortcuts).toEqual({ palette: "mod+shift+p", settings: null });

    updateSettings(file, { shortcuts: { palette: "default", settings: "default" } });
    expect(readSettings(file).shortcuts).toEqual({});
  });

  it("sets the pi path, and removes the key when you set it to null", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark" }));
    updateSettings(file, { piPath: "/opt/pi/bin/pi" });
    expect(readSettings(file).piPath).toBe("/opt/pi/bin/pi");

    updateSettings(file, { piPath: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
  });

  it.each([
    [{ piPath: "bin/pi" }, `has a piPath that isn't an absolute path: "bin/pi"`],
    [{ pool: { idleMinutes: 0 } }, "has a pool.idleMinutes that isn't a whole number"],
    [{ shortcuts: { palette: "mod+nope" } }, `has a palette shortcut that isn't one`],
  ])("refuses %j and leaves the file byte for byte as it was", (patch, problem) => {
    const content = '{ "theme": "dark",\n"later": true }';
    writeFileSync(file, content);

    expect(() => updateSettings(file, patch)).toThrow(
      `Tondo didn't save that change. It ${problem}`,
    );
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("saves a change, and keeps a shortcut for a command this version doesn't know", () => {
    writeFileSync(file, JSON.stringify({ shortcuts: { "toggle-terminal": "mod+j" } }));

    updateSettings(file, { theme: "dark", shortcuts: { palette: "mod+p" } });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      theme: "dark",
      shortcuts: { "toggle-terminal": "mod+j", palette: "mod+p" },
    });
  });

  it("names the file when it was already invalid", () => {
    writeFileSync(file, '{"theme":"blue"}');
    expect(() => updateSettings(file, { pool: { maxLive: 2 } })).toThrow(
      `Tondo's settings file ${file} has a theme that isn't system, light or dark`,
    );
  });
});

describe("saveTrustAnswer", () => {
  it("creates the file and its folder, keyed by the project's realpath", () => {
    const project = path.join(dir, "project");
    mkdirSync(project);
    const link = path.join(dir, "link");
    symlinkSync(project, link);
    file = path.join(dir, "userData", "settings.json");

    saveTrustAnswer(file, link, true);

    expect(readSettings(file)).toEqual({ ...DEFAULTS, projectTrust: { [project]: true } });
  });

  it("keeps the rest of the file, keys it doesn't know included", () => {
    writeFileSync(
      file,
      JSON.stringify({
        piPath: "/opt/pi/bin/pi",
        projectTrust: { "/work/a": true, "/work/b": true },
        later: { kept: 1 },
      }),
    );

    saveTrustAnswer(file, "/work/b", false);
    saveTrustAnswer(file, "/work/c", true);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      piPath: "/opt/pi/bin/pi",
      projectTrust: { "/work/a": true, "/work/b": false, "/work/c": true },
      later: { kept: 1 },
    });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("leaves a file it can't read as it was", () => {
    writeFileSync(file, '{"piPath":"bin/pi"}');

    expect(() => saveTrustAnswer(file, "/work/a", true)).toThrow(
      `Tondo's settings file ${file} has a piPath that isn't an absolute path`,
    );
    expect(readFileSync(file, "utf8")).toBe('{"piPath":"bin/pi"}');
  });
});
