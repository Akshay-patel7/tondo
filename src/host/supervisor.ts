// Starts each pi the host runs: the right pi, with your login shell's
// environment and the flags Tondo adds, in a process group main knows about.
import { existsSync } from "node:fs";
import path from "node:path";
import type { HostConfig } from "../shared/protocol";
import { findPi } from "./findPi";
import { captureLoginEnv } from "./loginEnv";
import { startPi, type PiLaunch, type PiProcess } from "./piProcess";
import type { PiRecord } from "./piRpc";
import { sessionFolder, type SessionFolder } from "./sessionFolder";
import { readSettings, saveTrustAnswer, type Settings } from "./settings";
import { canonical, needsTrustDecision, trustArgs } from "./trust";

/** A thread's pi session: its id, and the file pi keeps it in once pi has said where. */
export interface ThreadSession {
  readonly id: string;
  readonly file: string | null;
}

/**
 * The session pi opens: the file pi wrote, or else a session with this id,
 * which pi creates if it can't find one.
 */
export type SessionChoice = { readonly file: string } | { readonly id: string };

/** The command that runs pi in `cwd` on `session`, given your login shell's environment. */
export function piLaunch(
  cwd: string,
  session: SessionChoice,
  loginEnv: Record<string, string>,
  config: HostConfig,
  settings: Settings,
): PiLaunch {
  const env = piEnv(loginEnv, config);
  const pi = findPi(env, settings.piPath);
  return {
    command: pi.node,
    args: [
      pi.cli,
      "--mode",
      "rpc",
      ...("file" in session ? ["--session", session.file] : ["--session-id", session.id]),
      ...trustArgs(cwd, env, settings.projectTrust),
      ...config.piArgs,
    ],
    cwd,
    env,
  };
}

/** pi's environment: your login shell's, with the agent folder the config sets. */
function piEnv(loginEnv: Record<string, string>, config: HostConfig): Record<string, string> {
  return config.piAgentDir ? { ...loginEnv, PI_CODING_AGENT_DIR: config.piAgentDir } : loginEnv;
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

  /**
   * Starts pi in `cwd` on `session`. pi opens the session's file if it wrote
   * one, and otherwise starts the session afresh, since pi saves a session
   * only once it has a reply. `onRecord` gets every event pi writes.
   */
  async start(
    cwd: string,
    session: ThreadSession,
    onRecord: (record: PiRecord) => void,
  ): Promise<PiProcess> {
    const env = await this.captureLoginEnv();
    const settings = readSettings(this.settingsFile);
    const choice =
      session.file !== null && existsSync(session.file)
        ? { file: session.file }
        : { id: session.id };
    return startPi(piLaunch(cwd, choice, env, this.config, settings), {
      onRecord,
      onGroup: (pgid, running) => {
        if (running) this.groups.add(pgid);
        else this.groups.delete(pgid);
        this.reportGroups([...this.groups]);
      },
    });
  }

  /** Where pi, started in `cwd`, keeps the sessions it lists for `cwd`. */
  async sessionFolder(cwd: string): Promise<SessionFolder> {
    const env = piEnv(await this.captureLoginEnv(), this.config);
    return sessionFolder(cwd, this.config.piArgs, env);
  }

  /** Whether pi in `cwd` needs a trust decision that you haven't given Tondo yet. */
  async needsTrustAnswer(cwd: string): Promise<boolean> {
    const env = piEnv(await this.captureLoginEnv(), this.config);
    const { projectTrust } = readSettings(this.settingsFile);
    return projectTrust[canonical(cwd)] === undefined && needsTrustDecision(cwd, env);
  }

  /** Remembers whether you trust the project in `cwd`, for every pi started there later. */
  saveTrustAnswer(cwd: string, trusted: boolean): void {
    saveTrustAnswer(this.settingsFile, cwd, trusted);
  }

  private get settingsFile(): string {
    return path.join(this.config.userData, "settings.json");
  }

  /** Your login shell's environment. The shell runs once, the first time Tondo needs it. */
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
