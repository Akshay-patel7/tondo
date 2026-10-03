// node-pty 1.1.0's macOS prebuild ships spawn-helper without its execute bit.
// Fix it at install time, never by mutating a signed app at runtime.
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("node-pty/package.json"));
  const candidates = [
    path.join(root, "build/Release/spawn-helper"),
    path.join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
  ];
  const helpers = candidates.filter(existsSync);
  if (helpers.length === 0) throw new Error("node-pty has no macOS spawn-helper");
  for (const helper of helpers) chmodSync(helper, 0o755);
}
