import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings } from "./settings";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tondo-settings-"));
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
