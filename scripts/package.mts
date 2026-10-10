// Packages the built app (out/) with electron-builder and reads the fuses back.
// Run it through `pnpm package`, which builds out/ first. Flags:
//   --mac | --linux                    platform (default: the host's)
//   --arch arm64,x64                   architectures (default: the host's)
//   --target dmg,zip                   targets (default dmg,zip on mac, deb,AppImage on linux; "dir" is allowed)
//   --variant release|e2e              e2e only turns the inspect-arguments fuse on, for Playwright
//   --version X.Y.Z                    overrides package.json's version
//   --feed-url <url>                   publishes to a generic update server instead of GitHub
//   --publish never|always             (default never)
//   --output <dir>                     (default dist/, or dist/e2e/ for the e2e variant)
// Modeled on T3 Code's scripts/build-desktop-artifact.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import electronBuilder from "electron-builder";
import type { AfterPackContext, Configuration } from "electron-builder";

const { Arch, Platform, build } = electronBuilder;

type PlatformName = "mac" | "linux";
type ArchName = "arm64" | "x64";
type Variant = "release" | "e2e";
type SigningMode = "developer-id" | "ad-hoc";

const repoRoot = path.resolve(import.meta.dirname, "..");
const TARGETS: Record<PlatformName, readonly string[]> = {
  mac: ["dmg", "zip", "dir"],
  linux: ["deb", "AppImage", "dir"],
};
const DEFAULT_TARGETS: Record<PlatformName, readonly string[]> = {
  mac: ["dmg", "zip"],
  linux: ["deb", "AppImage"],
};

class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

const { values: flags } = parseArgs({
  options: {
    mac: { type: "boolean", default: false },
    linux: { type: "boolean", default: false },
    arch: { type: "string" },
    target: { type: "string" },
    variant: { type: "string", default: "release" },
    version: { type: "string" },
    "feed-url": { type: "string" },
    publish: { type: "string", default: "never" },
    output: { type: "string" },
  },
  strict: true,
});

function parsePlatform(): PlatformName {
  if (flags.mac && flags.linux) fail("Pass --mac or --linux, not both.");
  if (flags.mac) return "mac";
  if (flags.linux) return "linux";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";
  return fail(`Tondo doesn't package for ${process.platform}. Pass --mac or --linux.`);
}

function parseArchs(): readonly ArchName[] {
  const list = flags.arch?.split(",").map((it) => it.trim()) ?? [process.arch];
  return list.map((it) => (it === "arm64" || it === "x64" ? it : fail(`Unknown arch "${it}".`)));
}

function parseVariant(): Variant {
  const variant = flags.variant;
  return variant === "release" || variant === "e2e"
    ? variant
    : fail(`Unknown variant "${variant}".`);
}

function parsePublish(): "never" | "always" {
  const publish = flags.publish;
  return publish === "never" || publish === "always"
    ? publish
    : fail(`Unknown --publish "${publish}".`);
}

const platform = parsePlatform();
const archs = parseArchs();
const variant = parseVariant();
const publish = parsePublish();
const targets = flags.target?.split(",").map((it) => it.trim()) ?? DEFAULT_TARGETS[platform];
for (const target of targets) {
  if (!TARGETS[platform].includes(target)) fail(`${platform} can't build the "${target}" target.`);
}
if (flags.version !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(flags.version)) {
  fail(`--version "${flags.version}" isn't X.Y.Z.`);
}
const output = path.resolve(repoRoot, flags.output ?? (variant === "e2e" ? "dist/e2e" : "dist"));

if (!existsSync(path.join(repoRoot, "out/main/index.js"))) {
  fail("out/main/index.js is missing. Run `pnpm build` first, or use `pnpm package`.");
}

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  readonly description: string;
  readonly packageManager: string;
};
// electron-builder picks its node_modules collector from the package manager in this variable.
process.env.npm_config_user_agent ??= packageManagerUserAgent(packageJson.packageManager);

function packageManagerUserAgent(packageManager: string): string {
  const [name, version] = packageManager.split("@");
  return `${name}/${version}`;
}

// Fuses electron-builder flips before signing. The e2e variant differs only in
// EnableNodeCliInspectArguments, which Playwright needs to drive the app.
const intendedFuses = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: variant === "e2e",
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
} as const satisfies Partial<Record<FuseV1Options, boolean>>;

function macSigningMode(): SigningMode {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return "developer-id";
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  return identities.includes('"Developer ID Application:') ? "developer-id" : "ad-hoc";
}

// The env names app-builder-lib 26.15.3 reads in MacTargetHelper.getNotarizeOptions.
function hasNotarizeCredentials(): boolean {
  const env = process.env;
  return Boolean(
    (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) ||
    (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
    env.APPLE_KEYCHAIN_PROFILE,
  );
}

function publishConfig(): NonNullable<Configuration["publish"]> {
  if (flags["feed-url"] !== undefined) return { provider: "generic", url: flags["feed-url"] };
  return { provider: "github", owner: "Akshay-patel7", repo: "tondo", releaseType: "draft" };
}

// Packed apps, collected per architecture so their fuses can be read back.
const packedApps: { readonly arch: string; readonly fuseTarget: string }[] = [];

// Runs after each arch is packed and before it's signed.
function afterPack(context: AfterPackContext): void {
  const arch = Arch[context.arch];
  switch (context.electronPlatformName) {
    case "darwin": {
      const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      // node-pty 1.1.0 ships spawn-helper without its execute bit, and pnpm install
      // fixes only the host arch's copy (scripts/prepare-pty.mjs).
      chmodSync(
        path.join(
          app,
          `Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`,
        ),
        0o755,
      );
      packedApps.push({ arch, fuseTarget: app });
      return;
    }
    case "linux":
      packedApps.push({ arch, fuseTarget: path.join(context.appOutDir, "tondo") });
      return;
    default:
      fail(`Unexpected platform ${context.electronPlatformName}.`);
  }
}

const signingMode = platform === "mac" ? macSigningMode() : undefined;
const notarize = signingMode === "developer-id" && hasNotarizeCredentials();

// A platform's files list replaces the top-level one, so each platform repeats it.
const appFiles = ["out/**", "!**/*.map", "package.json"];

// node-pty's runtime files only. lib/index.js loads unixTerminal, terminal, eventEmitter2 and
// utils on macOS and Linux. utils.loadNativeModule takes pty.node from build/Release or
// prebuilds/<platform>-<arch>, and unixTerminal runs spawn-helper from the same folder.
// Everything else is Windows code, sources, tests or build intermediates.
const ptyDir = "**/node_modules/node-pty";
const ptyExcludes = [
  `!${ptyDir}/{deps,src,scripts,third_party,typings}`,
  `!${ptyDir}/{deps,src,scripts,third_party,typings}/**`,
  `!${ptyDir}/{binding.gyp,README.md}`,
  `!${ptyDir}/lib/**/*.test.js`,
  `!${ptyDir}/lib/{conpty_console_list_agent,interfaces,types,windowsConoutConnection,windowsPtyAgent,windowsTerminal}.js`,
  `!${ptyDir}/lib/{shared,worker}`,
  `!${ptyDir}/lib/{shared,worker}/**`,
  "!**/*.pdb",
  `!${ptyDir}/build/{*.mk,Makefile,config.gypi,gyp-mac-tool,.deps,node_gyp_bins}`,
  `!${ptyDir}/build/{.deps,node_gyp_bins}/**`,
  `!${ptyDir}/build/Release/{obj*,.deps}`,
  `!${ptyDir}/build/Release/{obj*,.deps}/**`,
  `!${ptyDir}/build/Release/*.{a,o,mk}`,
  `!${ptyDir}/build/Debug`,
  `!${ptyDir}/build/Debug/**`,
];

const config: Configuration = {
  appId: "io.github.akshay-patel7.tondo",
  productName: "Tondo",
  artifactName: "Tondo-${version}-${arch}.${ext}",
  directories: { buildResources: "build", output },
  files: appFiles,
  asar: true,
  asarUnpack: ["node_modules/node-pty/**"],
  npmRebuild: false,
  // The default (legacy) AppImage runtime needs libz.so and libfuse2, which stock Ubuntu 24.04
  // lacks, and its .desktop entry launches with --no-sandbox. The static runtime has neither.
  toolsets: { appimage: "1.0.3" },
  extraMetadata: {
    // Electron derives the Linux app_id from desktopName; syncDesktopName names the .desktop file after it.
    desktopName: "tondo.desktop",
    ...(flags.version === undefined ? {} : { version: flags.version }),
  },
  electronFuses: {
    runAsNode: intendedFuses[FuseV1Options.RunAsNode],
    enableCookieEncryption: intendedFuses[FuseV1Options.EnableCookieEncryption],
    enableNodeOptionsEnvironmentVariable:
      intendedFuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable],
    enableNodeCliInspectArguments: intendedFuses[FuseV1Options.EnableNodeCliInspectArguments],
    enableEmbeddedAsarIntegrityValidation:
      intendedFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    onlyLoadAppFromAsar: intendedFuses[FuseV1Options.OnlyLoadAppFromAsar],
    loadBrowserProcessSpecificV8Snapshot:
      intendedFuses[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot],
    grantFileProtocolExtraPrivileges: intendedFuses[FuseV1Options.GrantFileProtocolExtraPrivileges],
  },
  afterPack,
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    // electron-builder finds the Developer ID itself; otherwise sign ad hoc so arm64 runs.
    ...(signingMode === "ad-hoc" ? { identity: "-" } : {}),
    notarize,
    // ${arch} expands per architecture, so one run keeps only that arch's node-pty prebuild.
    files: [
      ...appFiles,
      "!**/node_modules/node-pty/prebuilds/!(darwin-${arch})/**",
      ...ptyExcludes,
    ],
  },
  linux: {
    executableName: "tondo",
    category: "Development",
    synopsis: packageJson.description,
    description: packageJson.description,
    maintainer: "Akshay Patel <52183644+Akshay-patel7@users.noreply.github.com>",
    syncDesktopName: true,
    // Linux builds node-pty from source into build/Release, so no prebuild is needed.
    files: [...appFiles, "!**/node_modules/node-pty/prebuilds/**", ...ptyExcludes],
  },
  publish: publishConfig(),
};

function builderPlatform(name: PlatformName) {
  switch (name) {
    case "mac":
      return Platform.MAC;
    case "linux":
      return Platform.LINUX;
    default:
      return assertNever(name);
  }
}

console.log(
  `Packaging Tondo: ${platform} ${archs.join(",")} [${targets.join(",")}], ${variant} variant, into ${path.relative(repoRoot, output) || "."}.`,
);
if (signingMode !== undefined) {
  console.log(
    `macOS signing: ${signingMode === "ad-hoc" ? "ad hoc (identity -), hardened runtime" : "Developer ID"}, notarization ${notarize ? "on" : "off"}.`,
  );
}

await build({
  projectDir: repoRoot,
  targets: builderPlatform(platform).createTarget([...targets], ...archs.map((it) => Arch[it])),
  config,
  publish,
});

function fuseLabel(state: FuseState | undefined): string {
  switch (state) {
    case FuseState.ENABLE:
      return "on";
    case FuseState.DISABLE:
      return "off";
    case FuseState.REMOVED:
      return "removed";
    case FuseState.INHERIT:
      return "inherit";
    case undefined:
      return "absent";
    default:
      return assertNever(state);
  }
}

// Read every fuse back from the packed binaries and compare with the intent.
const wires = await Promise.all(packedApps.map((app) => getCurrentFuseWire(app.fuseTarget)));
let mismatches = 0;
for (const [index, app] of packedApps.entries()) {
  const wire = wires[index] ?? fail(`No fuse wire for ${app.fuseTarget}.`);
  console.log(`\nFuses of ${path.relative(repoRoot, app.fuseTarget)} (${app.arch}):`);
  for (const [key, state] of Object.entries(wire)) {
    if (
      key === "version" ||
      key === "resetAdHocDarwinSignature" ||
      key === "strictlyRequireAllFuses"
    ) {
      continue;
    }
    const option = Number(key) as FuseV1Options;
    const intended: boolean | undefined = (
      intendedFuses as Partial<Record<FuseV1Options, boolean>>
    )[option];
    const actual = fuseLabel(state as FuseState);
    const expected = intended === undefined ? "Electron default" : intended ? "on" : "off";
    const ok = intended === undefined || actual === expected;
    if (!ok) mismatches += 1;
    console.log(
      `  ${(FuseV1Options[option] ?? `Fuse${key}`).padEnd(40)} ${actual.padEnd(8)} expected ${expected.padEnd(17)} ${ok ? "ok" : "MISMATCH"}`,
    );
  }
}
if (packedApps.length === 0)
  fail("electron-builder packed no app, so no fuses could be read back.");
if (mismatches > 0) {
  console.error(`\n${mismatches} fuse(s) differ from the intended values.`);
  process.exitCode = 1;
}
