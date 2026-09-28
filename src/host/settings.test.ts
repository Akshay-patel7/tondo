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
import { readSettings, saveTrustAnswer } from "./settings";

let dir: string;
let file: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-settings-")));
  file = path.join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readSettings", () => {
  it("holds the defaults when the file doesn't exist", () => {
    expect(readSettings(file)).toEqual({ projectTrust: {} });
  });

  it("reads the pi path and your trust answers, and ignores keys it doesn't know", () => {
    writeFileSync(
      file,
      JSON.stringify({
        piPath: "/opt/pi/bin/pi",
        projectTrust: { "/work/a": true, "/work/b": false },
        later: 1,
      }),
    );
    expect(readSettings(file)).toEqual({
      piPath: "/opt/pi/bin/pi",
      projectTrust: { "/work/a": true, "/work/b": false },
    });
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
  ])("names the file and the problem for %s", (content, problem) => {
    writeFileSync(file, content);
    expect(() => readSettings(file)).toThrow(`Tondo's settings file ${file} ${problem}`);
  });

  it("passes on errors other than a missing file", () => {
    mkdirSync(file);
    expect(() => readSettings(file)).toThrow(/EISDIR/);
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

    expect(readSettings(file)).toEqual({ projectTrust: { [project]: true } });
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
