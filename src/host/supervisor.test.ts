import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostConfig } from "../shared/protocol";
import { piLaunch } from "./supervisor";

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

describe("piLaunch", () => {
  it("runs the node beside pi on pi's cli.js, in RPC mode, with the extra arguments last", () => {
    const loginEnv = { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: "/yours" };
    const settings = { piPath: path.join(bin, "pi"), projectTrust: {} };
    expect(piLaunch(project, loginEnv, config, settings)).toEqual({
      command: path.join(bin, "node"),
      args: [cli, "--mode", "rpc", "-e", "faux-ext.ts"],
      cwd: project,
      env: { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: path.join(root, "agent") },
    });
  });

  it("keeps your PI_CODING_AGENT_DIR when the config sets none", () => {
    const loginEnv = { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: "/yours" };
    const settings = { piPath: path.join(bin, "pi"), projectTrust: {} };
    const packaged = { userData: config.userData, piArgs: [] };
    expect(piLaunch(project, loginEnv, packaged, settings).env).toEqual(loginEnv);
  });

  it("passes your trust answer, checked against the agent folder pi will use", () => {
    create(path.join(project, ".pi/settings.json"), "{}");
    // Your own agent folder trusts the project, but pi won't read it.
    create(path.join(root, "yours/trust.json"), JSON.stringify({ [project]: true }));
    const loginEnv = {
      HOME: path.join(root, "home"),
      PI_CODING_AGENT_DIR: path.join(root, "yours"),
    };
    const settings = { piPath: path.join(bin, "pi"), projectTrust: { [project]: false } };
    expect(piLaunch(project, loginEnv, config, settings).args).toEqual([
      cli,
      "--mode",
      "rpc",
      "--no-approve",
      "-e",
      "faux-ext.ts",
    ]);
  });
});
