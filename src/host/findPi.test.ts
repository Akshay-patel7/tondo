import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPi, PiNotFoundError } from "./findPi";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-find-pi-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * Lays out a Node install at `prefix` with pi `version` installed globally,
 * the way npm does, and returns its bin folder.
 */
function installPi(prefix: string, version: string, { node = true } = {}): string {
  const pkg = path.join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
  mkdirSync(path.join(pkg, "dist/bundle"), { recursive: true });
  writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version,
      bin: { pi: "dist/bundle/cli.js" },
    }),
  );
  writeFileSync(path.join(pkg, "dist/bundle/cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  const bin = path.join(prefix, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(
    "../lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    path.join(bin, "pi"),
  );
  if (node) writeFileSync(path.join(bin, "node"), "", { mode: 0o755 });
  return bin;
}

/** The message and problem of the PiNotFoundError `find` throws. */
function failure(find: () => unknown): { message: string; problem: unknown } {
  try {
    find();
  } catch (error) {
    if (error instanceof PiNotFoundError) return { message: error.message, problem: error.problem };
    throw error;
  }
  throw new Error("findPi found a pi");
}

const cliIn = (prefix: string) =>
  path.join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");

describe("findPi", () => {
  it("finds a global npm install on PATH", () => {
    const bin = installPi(path.join(root, "node"), "0.87.1");
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    expect(findPi({ PATH: `${empty}:${bin}` })).toEqual({
      command: path.join(bin, "pi"),
      node: path.join(bin, "node"),
      cli: cliIn(path.join(root, "node")),
      version: "0.87.1",
    });
  });

  it("follows an asdf shim to the newest pi it names", () => {
    const asdf = path.join(root, "asdf");
    installPi(path.join(asdf, "installs/nodejs/22.1.0"), "0.80.0");
    installPi(path.join(asdf, "installs/nodejs/24.15.0"), "0.87.1");
    installPi(path.join(asdf, "installs/nodejs/24.16.0"), "0.88.2");
    mkdirSync(path.join(asdf, "shims"));
    writeFileSync(
      path.join(asdf, "shims/pi"),
      [
        "#!/usr/bin/env bash",
        "# asdf-plugin: nodejs 22.1.0",
        "# asdf-plugin: nodejs 24.16.0",
        "# asdf-plugin: nodejs 24.15.0",
        "# asdf-plugin: nodejs 23.0.0",
        'exec asdf exec "pi" "$@"',
      ].join("\n"),
      { mode: 0o755 },
    );
    expect(findPi({ PATH: path.join(asdf, "shims") })).toEqual({
      command: path.join(asdf, "installs/nodejs/24.16.0/bin/pi"),
      node: path.join(asdf, "installs/nodejs/24.16.0/bin/node"),
      cli: cliIn(path.join(asdf, "installs/nodejs/24.16.0")),
      version: "0.88.2",
    });
  });

  it("lets the override win over PATH", () => {
    const onPath = installPi(path.join(root, "newer"), "0.90.0");
    const chosen = installPi(path.join(root, "chosen"), "0.87.1");
    expect(findPi({ PATH: onPath }, path.join(chosen, "pi"))).toMatchObject({ version: "0.87.1" });
  });

  it("refuses a pi older than 0.87.1", () => {
    const bin = installPi(path.join(root, "node"), "0.87.0");
    expect(failure(() => findPi({ PATH: bin }))).toEqual({
      message: `${bin}/pi is pi 0.87.0, and Tondo needs 0.87.1 or newer`,
      problem: { kind: "too-old", version: "0.87.0", required: "0.87.1", command: `${bin}/pi` },
    });
  });

  it("refuses an install with no node next to pi", () => {
    const bin = installPi(path.join(root, "node"), "0.87.1", { node: false });
    const message = `${bin}/pi has no node next to it at ${bin}/node`;
    expect(failure(() => findPi({ PATH: bin }))).toEqual({
      message,
      problem: { kind: "invalid", detail: message },
    });
  });

  it("refuses a command that isn't part of pi's package", () => {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "pi"), "#!/bin/sh\n", { mode: 0o755 });
    const message = `${bin}/pi isn't part of @earendil-works/pi-coding-agent`;
    expect(failure(() => findPi({ PATH: bin }))).toEqual({
      message,
      problem: { kind: "invalid", detail: message },
    });
  });

  it("refuses a pi package that names no pi command", () => {
    const bin = installPi(path.join(root, "node"), "0.87.1");
    const manifest = path.join(
      root,
      "node/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
    );
    writeFileSync(
      manifest,
      JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.87.1" }),
    );
    const message = `${manifest} names no pi command`;
    expect(failure(() => findPi({ PATH: bin }))).toEqual({
      message,
      problem: { kind: "invalid", detail: message },
    });
  });

  it("says so when no pi is on PATH", () => {
    const message = "No pi on PATH: /usr/bin:/bin";
    expect(failure(() => findPi({ PATH: "/usr/bin:/bin" }))).toEqual({
      message,
      problem: { kind: "not-found", detail: message },
    });
  });

  it("says so when the pi path in the settings doesn't exist", () => {
    const missing = path.join(root, "nowhere/pi");
    const message = `${missing} doesn't exist`;
    expect(failure(() => findPi({ PATH: "" }, missing))).toEqual({
      message,
      problem: { kind: "not-found", detail: message },
    });
  });

  it("says why each install an asdf shim names can't run", () => {
    const asdf = path.join(root, "asdf");
    installPi(path.join(asdf, "installs/nodejs/22.1.0"), "0.80.0");
    mkdirSync(path.join(asdf, "shims"));
    writeFileSync(
      path.join(asdf, "shims/pi"),
      "#!/usr/bin/env bash\n# asdf-plugin: nodejs 22.1.0\n# asdf-plugin: nodejs 23.0.0\n",
      { mode: 0o755 },
    );
    const installs = path.join(asdf, "installs/nodejs");
    // The old install is the problem to fix, so it decides the kind.
    expect(failure(() => findPi({ PATH: path.join(asdf, "shims") }))).toEqual({
      message:
        `${installs}/22.1.0/bin/pi is pi 0.80.0, and Tondo needs 0.87.1 or newer\n` +
        `${installs}/23.0.0/bin/pi doesn't exist`,
      problem: {
        kind: "too-old",
        version: "0.80.0",
        required: "0.87.1",
        command: `${installs}/22.1.0/bin/pi`,
      },
    });
  });
});
