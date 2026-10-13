// Runs with the selected pi's Node in a disposable process. Loading pi's package
// manager here keeps its dependencies out of Tondo's long-lived host.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import type { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiUpdate } from "../shared/piUpdates";
import type { PiInstall } from "./findPi";

export interface PiMaintenanceContext {
  readonly pi: PiInstall;
  readonly agentDir: string;
  readonly cwd: string;
  readonly projectTrusted: boolean;
  readonly env: Record<string, string>;
  readonly offline: boolean;
}

type ProbeInput = Omit<PiMaintenanceContext, "env" | "offline"> & {
  readonly update?: PiUpdate;
};

interface CommandStep {
  command: string;
  args: string[];
  steps?: CommandStep[];
}
interface PiConfigApi {
  getSelfUpdateCommand(
    name: string,
    npmCommand?: string[],
    target?: string,
  ): CommandStep | undefined;
}
interface GitSource {
  repo: string;
  pinned: boolean;
}
interface SemverApi {
  valid(version: string): string | null;
  gt(candidate: string, current: string): boolean;
  rcompare(a: string, b: string): number;
}
const exec = promisify(execFile);

/** The whole process group is also bounded and reaped by the parent. No shell strings. */
async function run(command: string, args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await exec(command, [...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function manifest(dir: string): { name: string; version: string } {
  const value = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  if (typeof value.name !== "string" || typeof value.version !== "string")
    throw new Error("The installed package has no name or version.");
  return value;
}

export async function probePiUpdates(input: ProbeInput): Promise<readonly PiUpdate[]> {
  const load = (file: string) =>
    import(/* @vite-ignore */ pathToFileURL(path.join(input.pi.packageDir, "dist", file)).href);
  const [{ DefaultPackageManager: Manager }, { SettingsManager: Settings }, config, git] =
    await Promise.all([
      load("core/package-manager.js") as Promise<{
        DefaultPackageManager: typeof DefaultPackageManager;
      }>,
      load("core/settings-manager.js") as Promise<{ SettingsManager: typeof SettingsManager }>,
      load("config.js") as Promise<PiConfigApi>,
      load("utils/git.js") as Promise<{ parseGitUrl(source: string): GitSource | null }>,
    ]);
  const semver = createRequire(path.join(input.pi.packageDir, "package.json"))(
    "semver",
  ) as SemverApi;
  const settings = Settings.create(input.cwd, input.agentDir, {
    projectTrusted: input.projectTrusted,
  });
  const errors = settings.drainErrors();
  if (errors.length) throw new Error(errors.map(({ error }) => error.message).join("\n"));
  const manager = new Manager({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager: settings,
  });
  const npm = settings.getNpmCommand() ?? ["npm"];
  const latestNpm = async (spec: string) => {
    const value: unknown = JSON.parse(
      await run(npm[0]!, [...npm.slice(1), "view", spec, "version", "--json"], input.cwd),
    );
    const versions = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === "string" && semver.valid(item) !== null,
    );
    const latest = versions.toSorted(semver.rcompare)[0];
    if (!latest) throw new Error("npm returned no valid version.");
    return latest;
  };
  const configured = manager.listConfiguredPackages();
  const self = manifest(input.pi.packageDir);

  if (input.update) {
    const target = input.update;
    if (!target.latest || target.state !== "available")
      throw new Error("This update is no longer available. Check again.");
    if (target.scope === "pi") {
      if (self.version !== target.installed || self.name !== target.source)
        throw new Error("The selected pi changed. Check again before updating.");
      const command = config.getSelfUpdateCommand(
        self.name,
        settings.getNpmCommand(),
        `${self.name}@${target.latest}`,
      );
      if (!command) throw new Error("Update this pi with the package manager that installed it.");
      for (const step of command.steps ?? [command]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- self-update steps must finish in order.
        await run(step.command, step.args, input.cwd);
      }
      if (manifest(input.pi.packageDir).version !== target.latest)
        throw new Error(
          "The selected pi did not reach the reviewed version. Check its installation before retrying.",
        );
      return [];
    }
    const entry = configured.find(
      (item) => item.source === target.source && item.scope === target.scope,
    );
    if (!entry?.installedPath) throw new Error("The package configuration changed. Check again.");
    if (target.source.startsWith("npm:")) {
      const installed = manifest(entry.installedPath);
      if (installed.version !== target.installed || installed.name !== target.name)
        throw new Error("The installed package changed. Check again.");
      await manager.install(`npm:${installed.name}@${target.latest}`, {
        local: target.scope === "project",
      });
      const activePath = manager.getInstalledPath(target.source, target.scope);
      if (!activePath || manifest(activePath).version !== target.latest)
        throw new Error("The package did not reach the reviewed version.");
    } else {
      const parsed = git.parseGitUrl(target.source);
      if (!parsed || parsed.pinned) throw new Error("Pinned and local packages are not updated.");
      const head = await run("git", ["rev-parse", "HEAD"], entry.installedPath);
      if (head !== target.installed)
        throw new Error("The installed checkout changed. Check again.");
      const dirty = await run(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"],
        entry.installedPath,
      );
      if (dirty.split("\n").some((line) => line && line !== "!! node_modules/"))
        throw new Error(
          "This package has local files or edits. Tondo will not let pi reset or clean them. Save them outside the package before updating.",
        );
      await manager.install(`${target.source}@${target.latest}`, {
        local: target.scope === "project",
      });
      if ((await run("git", ["rev-parse", "HEAD"], entry.installedPath)) !== target.latest)
        throw new Error("The package checkout did not reach the reviewed commit.");
    }
    return [];
  }

  const candidates = [
    { source: self.name, scope: "pi" as const, installedPath: input.pi.packageDir },
    ...configured,
  ];
  const result: PiUpdate[] = [];
  const check = async (index: number) => {
    const entry = candidates[index]!;
    const row: { -readonly [Key in keyof PiUpdate]: PiUpdate[Key] } = {
      id: String(index),
      name: entry.source,
      source: entry.source,
      scope: entry.scope,
      installed: null,
      latest: null,
      state: "unavailable",
      message: null,
    };
    try {
      if (!entry.installedPath) throw new Error("Configured but not installed.");
      if (entry.scope === "pi" || entry.source.startsWith("npm:")) {
        const installed = manifest(entry.installedPath);
        row.name = installed.name;
        row.installed = installed.version;
        const spec = entry.scope === "pi" ? entry.source : entry.source.slice(4);
        if (spec !== installed.name && !spec.startsWith(`${installed.name}@`))
          throw new Error("The package name does not match its configured npm source.");
        const suffix = spec.slice(installed.name.length).replace(/^@/, "");
        if (suffix && semver.valid(suffix)) {
          row.state = "pinned";
          row.message = "Pinned version. Tondo will not change the package declaration.";
        } else {
          row.latest = await latestNpm(spec);
          row.state = semver.gt(row.latest, installed.version) ? "available" : "current";
          if (
            entry.scope === "pi" &&
            !config.getSelfUpdateCommand(
              self.name,
              settings.getNpmCommand(),
              `${self.name}@${row.latest}`,
            )
          ) {
            row.state = "unavailable";
            row.message = "Update this pi with the package manager that installed it.";
          }
        }
      } else {
        const parsed = git.parseGitUrl(entry.source);
        if (!parsed) {
          row.state = "local";
          row.message = "Local package. Update its source yourself.";
        } else if (parsed.pinned) {
          row.state = "pinned";
          row.message = "Pinned Git ref. Tondo will not move it.";
        } else {
          row.installed = await run("git", ["rev-parse", "HEAD"], entry.installedPath);
          const upstream = await run(
            "git",
            ["rev-parse", "--abbrev-ref", "@{upstream}"],
            entry.installedPath,
          ).catch(() => "");
          const ref = upstream.startsWith("origin/") ? `refs/heads/${upstream.slice(7)}` : "HEAD";
          const remote = await run("git", ["ls-remote", "origin", ref], entry.installedPath);
          const sha = /^([0-9a-f]{40,64})\s/m.exec(remote)?.[1];
          if (!sha) throw new Error("The remote returned no commit.");
          row.latest = sha;
          row.state = sha === row.installed ? "current" : "available";
        }
      }
    } catch (error) {
      row.state = "unavailable";
      row.message = error instanceof Error ? error.message : String(error);
    }
    result[index] = row;
  };
  // Four workers bound registry and remote checks without serializing every package.
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let index = next++; index < candidates.length; index = next++) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each worker takes one package at a time.
        await check(index);
      }
    }),
  );
  return result;
}

if (path.basename(process.argv[1] ?? "") === "piUpdateProbe.js") {
  probePiUpdates(JSON.parse(process.argv[2]!)).then(
    (entries) => console.log(`TONDO_PI_UPDATE_RESULT:${JSON.stringify(entries)}`),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
