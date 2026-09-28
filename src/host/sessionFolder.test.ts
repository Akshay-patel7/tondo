import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionFolder } from "./sessionFolder";

let home: string;
let project: string;
let env: Record<string, string>;
beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-folder-")));
  project = path.join(home, "work", "my app");
  mkdirSync(project, { recursive: true });
  env = { HOME: home };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** The folder pi names after `project` inside `agentDir`. */
const own = (agentDir = path.join(home, ".pi", "agent")) =>
  path.join(agentDir, "sessions", `--${project.slice(1).replaceAll("/", "-")}--`);

function writeSettings(file: string, settings: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof settings === "string" ? settings : JSON.stringify(settings));
}
const yourSettings = (settings: unknown) =>
  writeSettings(path.join(home, ".pi", "agent", "settings.json"), settings);
const projectSettings = (settings: unknown) =>
  writeSettings(path.join(project, ".pi", "settings.json"), settings);

describe("sessionFolder", () => {
  it("is a folder named after the project in pi's agent folder by default", () => {
    expect(sessionFolder(project, [], env)).toEqual({ dir: own(), shared: false });
  });

  it("turns colons into dashes as well as slashes", () => {
    const odd = path.join(home, "a:b");
    expect(sessionFolder(odd, [], env).dir).toBe(
      path.join(home, ".pi", "agent", "sessions", `--${odd.slice(1).replaceAll(/[/:]/g, "-")}--`),
    );
  });

  it("follows PI_CODING_AGENT_DIR, with ~ for your home folder", () => {
    env.PI_CODING_AGENT_DIR = "~/agent";
    expect(sessionFolder(project, [], env)).toEqual({
      dir: own(path.join(home, "agent")),
      shared: false,
    });
  });

  it("puts --session-dir first, the last one winning, relative to the project", () => {
    env.PI_CODING_AGENT_SESSION_DIR = path.join(home, "from-env");
    yourSettings({ sessionDir: path.join(home, "from-settings") });
    const args = ["--session-dir", "~/first", "--offline", "--session-dir", "sessions"];
    expect(sessionFolder(project, args, env)).toEqual({
      dir: path.join(project, "sessions"),
      shared: true,
    });
    // A flag with nothing after it isn't one.
    expect(sessionFolder(project, ["--session-dir"], env).dir).toBe(path.join(home, "from-env"));
  });

  it("puts PI_CODING_AGENT_SESSION_DIR before the sessionDir setting", () => {
    env.PI_CODING_AGENT_SESSION_DIR = "~/from-env";
    yourSettings({ sessionDir: path.join(home, "from-settings") });
    expect(sessionFolder(project, [], env)).toEqual({
      dir: path.join(home, "from-env"),
      shared: true,
    });
  });

  it("reads the sessionDir setting, the project's over yours", () => {
    yourSettings({ sessionDir: "~/yours" });
    expect(sessionFolder(project, [], env).dir).toBe(path.join(home, "yours"));
    projectSettings({ sessionDir: pathToFileURL(path.join(home, "project's")).href });
    expect(sessionFolder(project, [], env).dir).toBe(path.join(home, "project's"));
    // A project's null clears yours, as pi's deep merge does.
    projectSettings({ sessionDir: null });
    expect(sessionFolder(project, [], env)).toEqual({ dir: own(), shared: false });
  });

  it("ignores a settings file it can't read, as pi does", () => {
    yourSettings({ sessionDir: "~/yours" });
    projectSettings("{broken");
    expect(sessionFolder(project, [], env).dir).toBe(path.join(home, "yours"));
    projectSettings(["not", "settings"]);
    expect(sessionFolder(project, [], env).dir).toBe(path.join(home, "yours"));
  });

  it("isn't shared when a setting names the project's own folder", () => {
    yourSettings({ sessionDir: own() });
    expect(sessionFolder(project, [], env)).toEqual({ dir: own(), shared: false });
  });
});
