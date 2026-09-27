// Starts each pi the host runs: the right pi, with your login shell's
// environment and the flags Tondo adds, in a process group main knows about.
import path from "node:path";
import type { HostConfig } from "../shared/protocol";
import { findPi } from "./findPi";
import { captureLoginEnv } from "./loginEnv";
import { startPi, type PiLaunch, type PiProcess } from "./piProcess";
import type { PiRecord } from "./piRpc";
import { readSettings, type Settings } from "./settings";
import { trustArgs } from "./trust";

/** The command that runs pi in `cwd`, given your login shell's environment. */
export function piLaunch(
  cwd: string,
  loginEnv: Record<string, string>,
  config: HostConfig,
  settings: Settings,
): PiLaunch {
  const env = config.piAgentDir
    ? { ...loginEnv, PI_CODING_AGENT_DIR: config.piAgentDir }
    : loginEnv;
  const pi = findPi(env, settings.piPath);
  return {
    command: pi.node,
    args: [
      pi.cli,
      "--mode",
      "rpc",
      ...trustArgs(cwd, env, settings.projectTrust),
      ...config.piArgs,
    ],
    cwd,
    env,
  };
}

export class Supervisor {
  private readonly config: HostConfig;
  private readonly reportGroups: (pgids: number[]) => void;
  private readonly groups = new Set<number>();
  private loginEnv: Promise<Record<string, string>> | undefined;

  /** `reportGroups` gets every process group a running pi leads, each time the list changes. */
  constructor(config: HostConfig, reportGroups: (pgids: number[]) => void) {
    this.config = config;
    this.reportGroups = reportGroups;
  }

  /** Starts pi in `cwd`. `onRecord` gets every event it writes. */
  async start(cwd: string, onRecord: (record: PiRecord) => void): Promise<PiProcess> {
    const env = await this.captureLoginEnv();
    const settings = readSettings(path.join(this.config.userData, "settings.json"));
    return startPi(piLaunch(cwd, env, this.config, settings), {
      onRecord,
      onGroup: (pgid, running) => {
        if (running) this.groups.add(pgid);
        else this.groups.delete(pgid);
        this.reportGroups([...this.groups]);
      },
    });
  }

  /** Your login shell's environment. The shell runs once, as the first pi starts. */
  private captureLoginEnv(): Promise<Record<string, string>> {
    this.loginEnv ??= captureLoginEnv(process.env).then(({ env, problem }) => {
      if (problem) {
        console.error(
          `Tondo Host couldn't read your login shell's environment, so pi gets Tondo's own. ${problem}`,
        );
      }
      return env;
    });
    return this.loginEnv;
  }
}
