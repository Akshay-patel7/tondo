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

const cliIn = (prefix: string) =>
  path.join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");

describe("findPi", () => {
  it("finds a global npm install on PATH", () => {
    const bin = installPi(path.join(root, "node"), "0.87.1");
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    expect(findPi({ PATH: `${empty}:${bin}` })).toEqual({
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
    expect(() => findPi({ PATH: bin })).toThrow(
      new PiNotFoundError(`${bin}/pi is pi 0.87.0, and Tondo needs 0.87.1 or newer`),
    );
  });

  it("refuses an install with no node next to pi", () => {
    const bin = installPi(path.join(root, "node"), "0.87.1", { node: false });
    expect(() => findPi({ PATH: bin })).toThrow(
      new PiNotFoundError(`${bin}/pi has no node next to it at ${bin}/node`),
    );
  });

  it("says so when no pi is on PATH", () => {
    expect(() => findPi({ PATH: "/usr/bin:/bin" })).toThrow(
      new PiNotFoundError("No pi on PATH: /usr/bin:/bin"),
    );
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
    expect(() => findPi({ PATH: path.join(asdf, "shims") })).toThrow(
      new PiNotFoundError(
        `${installs}/22.1.0/bin/pi is pi 0.80.0, and Tondo needs 0.87.1 or newer\n` +
          `${installs}/23.0.0/bin/pi doesn't exist`,
      ),
    );
  });
});
