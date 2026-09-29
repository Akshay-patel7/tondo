import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { needsTrustDecision, piTrust, trustArgs } from "./trust";

let root: string;
let home: string;
let project: string;
let env: Record<string, string>;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-trust-")));
  home = path.join(root, "home");
  project = path.join(root, "work/project");
  mkdirSync(home);
  mkdirSync(project, { recursive: true });
  env = { HOME: home, PI_CODING_AGENT_DIR: path.join(root, "agent") };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function create(file: string, content = ""): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
const trustStore = (decisions: Record<string, boolean | null>) =>
  create(path.join(root, "agent/trust.json"), JSON.stringify(decisions));

describe("needsTrustDecision", () => {
  it("is false for a project with nothing protected", () => {
    create(path.join(project, "AGENTS.md"));
    create(path.join(project, ".pi/sessions/thread.jsonl"));
    expect(needsTrustDecision(project, env)).toBe(false);
  });

  it.each([
    "settings.json",
    "extensions",
    "skills",
    "prompts",
    "themes",
    "SYSTEM.md",
    "APPEND_SYSTEM.md",
  ])("is true for a project with .pi/%s", (name) => {
    create(path.join(project, ".pi", name));
    expect(needsTrustDecision(project, env)).toBe(true);
  });

  it("counts .agents/skills in the folder or a parent, except your home's", () => {
    mkdirSync(path.join(home, ".agents/skills"), { recursive: true });
    expect(needsTrustDecision(home, env)).toBe(false);
    expect(needsTrustDecision(project, env)).toBe(false);
    mkdirSync(path.join(root, "work/.agents/skills"), { recursive: true });
    expect(needsTrustDecision(project, env)).toBe(true);
  });

  it("is false once pi's trust.json holds a decision for the folder or a parent", () => {
    create(path.join(project, ".pi/prompts/hello.md"));
    trustStore({ [path.join(root, "elsewhere")]: true });
    expect(needsTrustDecision(project, env)).toBe(true);
    trustStore({ [project]: true });
    expect(needsTrustDecision(project, env)).toBe(false);
    // pi skips a null and takes the parent's decision.
    trustStore({ [project]: null, [path.join(root, "work")]: false });
    expect(needsTrustDecision(project, env)).toBe(false);
  });

  it("finds the decision for a folder opened through a symlink", () => {
    create(path.join(project, ".pi/SYSTEM.md"));
    trustStore({ [project]: true });
    symlinkSync(project, path.join(root, "link"));
    expect(needsTrustDecision(path.join(root, "link"), env)).toBe(false);
  });

  it("is false when pi's defaultProjectTrust settles it", () => {
    create(path.join(project, ".pi/settings.json"));
    const settings = path.join(root, "agent/settings.json");
    for (const [value, needed] of [
      ["always", false],
      ["never", false],
      ["ask", true],
      ["sometimes", true],
    ] as const) {
      create(settings, JSON.stringify({ defaultProjectTrust: value }));
      expect(needsTrustDecision(project, env), value).toBe(needed);
    }
    create(settings, "{ broken");
    expect(needsTrustDecision(project, env)).toBe(true);
  });

  it("reads pi's files from PI_CODING_AGENT_DIR with ~ expanded, else from ~/.pi/agent", () => {
    create(path.join(project, ".pi/themes/dark.json"));
    create(path.join(home, "pi-agent/trust.json"), JSON.stringify({ [project]: true }));
    expect(needsTrustDecision(project, { HOME: home, PI_CODING_AGENT_DIR: "~/pi-agent" })).toBe(
      false,
    );
    expect(needsTrustDecision(project, { HOME: home })).toBe(true);
    create(path.join(home, ".pi/agent/trust.json"), `\uFEFF${JSON.stringify({ [project]: true })}`);
    expect(needsTrustDecision(project, { HOME: home })).toBe(false);
  });

  it("fails on a trust.json pi would refuse", () => {
    create(path.join(project, ".pi/extensions/tool.ts"));
    const file = path.join(root, "agent/trust.json");
    create(file, "[]");
    expect(() => needsTrustDecision(project, env)).toThrow(
      `pi's trust store ${file} isn't a JSON object`,
    );
    create(file, JSON.stringify({ [project]: "yes" }));
    expect(() => needsTrustDecision(project, env)).toThrow(
      `pi's trust store ${file} holds "yes" for ${project}, not true, false or null`,
    );
    create(file, "{");
    expect(() => needsTrustDecision(project, env)).toThrow(`Can't read pi's trust store ${file}: `);
  });

  it("doesn't read trust.json for a project with nothing protected", () => {
    create(path.join(root, "agent/trust.json"), "{");
    expect(needsTrustDecision(project, env)).toBe(false);
  });
});

describe("piTrust", () => {
  it("says who settles trust, for /trust to explain", () => {
    expect(piTrust(project, env)).toEqual({ decidedBy: "nothing" });
    create(path.join(project, ".pi/prompts/hello.md"));
    expect(piTrust(project, env)).toEqual({ decidedBy: "ask" });
    create(
      path.join(root, "agent/settings.json"),
      JSON.stringify({ defaultProjectTrust: "never" }),
    );
    expect(piTrust(project, env)).toEqual({ decidedBy: "default", trusted: false });
    // A saved decision comes before the default, and names the folder it's for.
    trustStore({ [project]: null, [path.join(root, "work")]: true });
    expect(piTrust(project, env)).toEqual({
      decidedBy: "trust-file",
      trusted: true,
      folder: path.join(root, "work"),
    });
  });
});

describe("trustArgs", () => {
  it("passes your answer only when pi needs a decision", () => {
    expect(trustArgs(project, env, { [project]: true })).toEqual([]);
    create(path.join(project, ".pi/prompts/hello.md"));
    expect(trustArgs(project, env, {})).toEqual([]);
    expect(trustArgs(project, env, { [project]: true })).toEqual(["--approve"]);
    expect(trustArgs(project, env, { [project]: false })).toEqual(["--no-approve"]);
    trustStore({ [project]: false });
    expect(trustArgs(project, env, { [project]: true })).toEqual([]);
  });

  it("looks your answer up by the folder's realpath", () => {
    create(path.join(project, ".pi/prompts/hello.md"));
    symlinkSync(project, path.join(root, "link"));
    expect(trustArgs(path.join(root, "link"), env, { [project]: true })).toEqual(["--approve"]);
  });
});
