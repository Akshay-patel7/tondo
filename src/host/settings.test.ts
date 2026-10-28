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
  newShortcutProblems,
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
      worktreeDirectory: null,
      defaultModel: null,
      defaultThinkingLevel: null,
      theme: "system",
      palette: "default",
      expandThinking: false,
      panelWidths: { sidebar: 256, changes: 432 },
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
        palette: "ocean",
        expandThinking: true,
        pool: { maxLive: 12, idleMinutes: 240 },
        shortcuts: { palette: "mod+shift+p", settings: null },
        projectTrust: { "/work/a": true, "/work/b": false },
        later: 1,
      }),
    );
    expect(readSettings(file)).toEqual({
      piPath: "/opt/pi/bin/pi",
      worktreeDirectory: null,
      defaultModel: null,
      defaultThinkingLevel: null,
      theme: "dark",
      palette: "ocean",
      expandThinking: true,
      panelWidths: { sidebar: 256, changes: 432 },
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
    ['{"palette":"teal"}', `has a palette that isn't default, slate, ocean or rose: "teal"`],
    ['{"palette":null}', "has a palette that isn't default, slate, ocean or rose: null"],
    ['{"expandThinking":"true"}', 'has an expandThinking that isn\'t true or false: "true"'],
    ['{"expandThinking":null}', "has an expandThinking that isn't true or false: null"],
    ['{"panelWidths":null}', "has panelWidths that aren't an object"],
    [
      '{"panelWidths":{"sidebar":199}}',
      "has a panelWidths.sidebar that isn't a whole number from 200 to 480",
    ],
    [
      '{"panelWidths":{"sidebar":481}}',
      "has a panelWidths.sidebar that isn't a whole number from 200 to 480",
    ],
    [
      '{"panelWidths":{"changes":279}}',
      "has a panelWidths.changes that isn't a whole number from 280 to 800",
    ],
    [
      '{"panelWidths":{"changes":801}}',
      "has a panelWidths.changes that isn't a whole number from 280 to 800",
    ],
    ['{"panelWidths":{"sidebar":256.5}}', "has a panelWidths.sidebar that isn't a whole number"],
    ['{"panelWidths":{"sidebar":null}}', "has a panelWidths.sidebar that isn't a whole number"],
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
        palette: "teal",
        pool: { maxLive: 9999, idleMinutes: 30 },
        shortcuts: { palette: "mod+", settings: "mod+j" },
        projectTrust: { "/work/a": true, "/work/b": "yes" },
      }),
    );
    expect(readSettingsLeniently(file)).toEqual({
      settings: {
        piPath: "/opt/pi/bin/pi",
        worktreeDirectory: null,
        defaultModel: null,
        defaultThinkingLevel: null,
        theme: "system",
        palette: "default",
        expandThinking: false,
        panelWidths: { sidebar: 256, changes: 432 },
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

describe("newShortcutProblems", () => {
  it("lets a change through when the bindings already had a problem it leaves as it was", () => {
    // Command palette on mod+n clashes with New thread's default.
    expect(newShortcutProblems({ palette: "mod+n" }, { settings: "mod+j" })).toEqual([]);
  });

  it("refuses a change that brings a problem of its own", () => {
    expect(newShortcutProblems({ palette: "mod+n" }, { "add-project": "mod+b" })).toEqual([
      "Toggle sidebar and Add project both use mod+b.",
    ]);
  });

  it("lets a change through that fixes the problem", () => {
    expect(newShortcutProblems({ palette: "mod+n" }, { palette: "default" })).toEqual([]);
  });
});

describe("updateSettings", () => {
  it("saves and resets the worktree directory without losing unrelated keys", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark", later: true }));
    expect(readSettings(file).worktreeDirectory).toBeNull();
    const folder = path.join(dir, "custom");
    expect(updateSettings(file, { worktreeDirectory: folder }).worktreeDirectory).toBe(folder);
    expect(readSettings(file).worktreeDirectory).toBe(folder);
    expect(updateSettings(file, { worktreeDirectory: null }).worktreeDirectory).toBeNull();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark", later: true });
  });

  it.each(["relative", "", 1, null, "/path\0bad"])(
    "defaults invalid saved worktree directories and preserves other settings: %j",
    (worktreeDirectory) => {
      writeFileSync(file, JSON.stringify({ worktreeDirectory, theme: "dark" }));
      expect(() => readSettings(file)).toThrow("worktreeDirectory");
      expect(readSettingsLeniently(file)).toMatchObject({
        settings: { ...DEFAULTS, theme: "dark" },
        problem: expect.stringContaining("worktreeDirectory"),
      });
    },
  );

  it("rejects a relative directory without changing the file", () => {
    const content = JSON.stringify({ theme: "dark", later: true });
    writeFileSync(file, content);
    expect(() => updateSettings(file, { worktreeDirectory: "relative" })).toThrow("absolute path");
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("saves either panel width independently and preserves unrelated settings and future keys", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark", later: true, panelWidths: { extra: 7 } }));
    expect(readSettings(file).panelWidths).toEqual({ sidebar: 256, changes: 432 });
    expect(updateSettings(file, { panelWidths: { sidebar: 360 } }).panelWidths).toEqual({
      sidebar: 360,
      changes: 432,
    });
    expect(updateSettings(file, { panelWidths: { changes: 600 } }).panelWidths).toEqual({
      sidebar: 360,
      changes: 600,
    });
    expect(readSettings(file).panelWidths).toEqual({ sidebar: 360, changes: 600 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      theme: "dark",
      later: true,
      panelWidths: { extra: 7, sidebar: 360, changes: 600 },
    });
  });

  it("defaults only the malformed width in a lenient read", () => {
    writeFileSync(
      file,
      JSON.stringify({ theme: "dark", panelWidths: { sidebar: 500, changes: 600 } }),
    );
    const { settings, problem } = readSettingsLeniently(file);
    expect(settings).toEqual({
      ...DEFAULTS,
      theme: "dark",
      panelWidths: { sidebar: 256, changes: 600 },
    });
    expect(problem).toContain("panelWidths.sidebar");
  });

  it("saves and clears new-session defaults without changing other settings", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark", later: true }));
    const defaults = {
      defaultModel: { provider: "faux", id: "faux-1" },
      defaultThinkingLevel: "high" as const,
    };
    expect(updateSettings(file, defaults)).toMatchObject(defaults);
    expect(readSettings(file)).toMatchObject(defaults);
    expect(updateSettings(file, { defaultModel: null }).defaultThinkingLevel).toBe("high");
    expect(updateSettings(file, { defaultThinkingLevel: null })).toMatchObject({
      defaultModel: null,
      defaultThinkingLevel: null,
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      theme: "dark",
      later: true,
      defaultModel: null,
      defaultThinkingLevel: null,
    });
  });

  it.each([
    { defaultModel: "faux/faux-1" },
    { defaultModel: { provider: "faux", id: "" } },
    { defaultModel: { provider: "", id: "faux-1" } },
    { defaultModel: { provider: "faux", id: "x".repeat(513) } },
    { defaultModel: { provider: "faux", id: "x\0y" } },
    { defaultThinkingLevel: "extreme" },
    { defaultThinkingLevel: 1 },
  ])("rejects malformed defaults and keeps other settings on a lenient read: %j", (defaults) => {
    const content = JSON.stringify({ theme: "dark", ...defaults });
    writeFileSync(file, content);
    expect(() => readSettings(file)).toThrow("default");
    expect(readSettingsLeniently(file)).toMatchObject({
      settings: { ...DEFAULTS, theme: "dark" },
      problem: expect.stringContaining("default"),
    });
    expect(() => updateSettings(file, { theme: "light" })).toThrow("default");
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("saves and disables expanded thinking without changing other settings", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark", later: 1 }));
    expect(readSettings(file).expandThinking).toBe(false);
    expect(updateSettings(file, { expandThinking: true }).expandThinking).toBe(true);
    expect(readSettings(file).expandThinking).toBe(true);
    expect(updateSettings(file, { expandThinking: false }).expandThinking).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      theme: "dark",
      later: 1,
      expandThinking: false,
    });
  });

  it("reports invalid expanded thinking and defaults it on a lenient read", () => {
    writeFileSync(file, JSON.stringify({ expandThinking: 1, theme: "dark" }));
    expect(readSettingsLeniently(file)).toEqual({
      settings: { ...DEFAULTS, theme: "dark" },
      problem: `Tondo's settings file ${file} has an expandThinking that isn't true or false: 1`,
    });
  });

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

  it("saves the palette apart from the theme, and gives a file from before palettes the default", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark" }));
    expect(readSettings(file).palette).toBe("default");

    expect(updateSettings(file, { palette: "rose" })).toMatchObject({
      theme: "dark",
      palette: "rose",
    });
    expect(updateSettings(file, { theme: "light" }).palette).toBe("rose");

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "light", palette: "rose" });
  });

  it("sets the pi path, and removes the key when you set it to null", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark" }));
    updateSettings(file, { piPath: "/opt/pi/bin/pi" });
    expect(readSettings(file).piPath).toBe("/opt/pi/bin/pi");

    updateSettings(file, { piPath: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
  });

  it.each([
    [{ panelWidths: { changes: 2000 } }, "has a panelWidths.changes that isn't a whole number"],
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

  it("keeps other changes off a palette it doesn't know, and picking a palette fixes it", () => {
    writeFileSync(file, '{"palette":"teal"}');
    expect(() => updateSettings(file, { theme: "dark" })).toThrow(
      `Tondo's settings file ${file} has a palette that isn't default, slate, ocean or rose: "teal"`,
    );
    expect(readFileSync(file, "utf8")).toBe('{"palette":"teal"}');

    expect(updateSettings(file, { palette: "slate" }).palette).toBe("slate");
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
