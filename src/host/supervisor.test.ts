import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostConfig } from "../shared/protocol";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { piLaunch, Supervisor, TrustNotSavedError } from "./supervisor";

const piPackage = path.resolve(
  import.meta.dirname,
  "../../node_modules/@earendil-works/pi-coding-agent",
);
const cli = realpathSync(path.join(piPackage, "dist/bundle/cli.js"));

let root: string;
let bin: string;
let project: string;
let config: HostConfig;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-supervisor-")));
  // The pinned pi, installed the way findPi expects: a pi command with a node beside it.
  bin = path.join(root, "bin");
  mkdirSync(bin);
  symlinkSync(cli, path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  project = path.join(root, "project");
  mkdirSync(project);
  mkdirSync(path.join(root, "home"));
  config = {
    userData: path.join(root, "userData"),
    piAgentDir: path.join(root, "agent"),
    piArgs: ["-e", "faux-ext.ts"],
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function create(file: string, content = ""): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

describe("Supervisor", () => {
  it("says a trust answer it can't save is about the settings file, and names it", () => {
    const file = path.join(config.userData, "settings.json");
    create(file, "{");
    const supervisor = new Supervisor(config, () => {});

    let error: unknown;
    try {
      supervisor.saveTrustAnswer(project, true);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TrustNotSavedError);
    expect((error as TrustNotSavedError).file).toBe(file);
    expect((error as Error).message).toContain(
      `Tondo couldn't save your answer. Tondo's settings file ${file} isn't valid JSON`,
    );
  });

  it("reads what it can of a settings file with a mistake in it, for starting pi", () => {
    create(
      path.join(config.userData, "settings.json"),
      JSON.stringify({
        theme: "sepia",
        shortcuts: { "toggle-terminal": "mod+j" },
        projectTrust: { [project]: true },
      }),
    );
    const { settings, problem } = new Supervisor(config, () => {}).readableSettings();
    expect(settings.projectTrust).toEqual({ [project]: true });
    expect(problem).toContain("has a theme that isn't system, light or dark");
  });
});

describe("piLaunch", () => {
  it("runs the node beside pi on pi's cli.js, in RPC mode on the session, with the extra arguments last", () => {
    const loginEnv = { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: "/yours" };
    const settings = { ...DEFAULT_SETTINGS, piPath: path.join(bin, "pi"), projectTrust: {} };
    expect(piLaunch(project, { id: "session-1" }, loginEnv, config, settings)).toEqual({
      command: path.join(bin, "node"),
      args: [cli, "--mode", "rpc", "--session-id", "session-1", "-e", "faux-ext.ts"],
      cwd: project,
      env: { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: path.join(root, "agent") },
    });
  });

  it("opens a session pi saved by its file", () => {
    const loginEnv = { HOME: path.join(root, "home") };
    const settings = { ...DEFAULT_SETTINGS, piPath: path.join(bin, "pi"), projectTrust: {} };
    const file = path.join(root, "agent/sessions/--x--/2026_thread.jsonl");
    expect(piLaunch(project, { file }, loginEnv, config, settings).args).toEqual([
      cli,
      "--mode",
      "rpc",
      "--session",
      file,
      "-e",
      "faux-ext.ts",
    ]);
  });

  it("keeps your PI_CODING_AGENT_DIR when the config sets none", () => {
    const loginEnv = { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: "/yours" };
    const settings = { ...DEFAULT_SETTINGS, piPath: path.join(bin, "pi"), projectTrust: {} };
    const packaged = { userData: config.userData, piArgs: [] };
    expect(piLaunch(project, { id: "session-1" }, loginEnv, packaged, settings).env).toEqual(
      loginEnv,
    );
  });

  it("passes your trust answer, checked against the agent folder pi will use", () => {
    create(path.join(project, ".pi/settings.json"), "{}");
    // Your own agent folder trusts the project, but pi won't read it.
    create(path.join(root, "yours/trust.json"), JSON.stringify({ [project]: true }));
    const loginEnv = {
      HOME: path.join(root, "home"),
      PI_CODING_AGENT_DIR: path.join(root, "yours"),
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      piPath: path.join(bin, "pi"),
      projectTrust: { [project]: false },
    };
    expect(piLaunch(project, { id: "session-1" }, loginEnv, config, settings).args).toEqual([
      cli,
      "--mode",
      "rpc",
      "--session-id",
      "session-1",
      "--no-approve",
      "-e",
      "faux-ext.ts",
    ]);
  });
});
