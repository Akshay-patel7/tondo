import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { PiRpc, type PiRecord } from "./piRpc";
import { drainGroup, signalGroup } from "./processGroup";

/** The command that runs pi, with every flag Tondo adds. */
export interface PiLaunch {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PiExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The end of pi's stderr, for error reports. */
  stderrTail: string;
}

export interface PiHandlers {
  /** Every event pi writes, in order. */
  onRecord: (record: PiRecord) => void;
  /** pi's process group has started (true) or has no processes left (false). */
  onGroup: (pgid: number, running: boolean) => void;
}

export interface StopTimings {
  /** How long pi gets to exit after its stdin closes, before SIGTERM. */
  stdinGraceMs: number;
  /** How long after SIGTERM before SIGKILL. */
  termGraceMs: number;
}

export const STOP_TIMINGS: StopTimings = { stdinGraceMs: 5_000, termGraceMs: 3_000 };
/**
 * How long pi's stdout may stay open once its group is empty. Only a detached
 * process that inherited it can hold it that long.
 */
const OUTPUT_GRACE_MS = 1_000;

export class PiExitError extends Error {
  override name = "PiExitError";
  readonly exit: PiExit;

  constructor(exit: PiExit) {
    const how = exit.signal ? `was killed by ${exit.signal}` : `exited with code ${exit.code}`;
    const stderr = exit.stderrTail.trim();
    super(`pi ${how}.${stderr ? `\n\npi's stderr ended with:\n${stderr}` : ""}`);
    this.exit = exit;
  }
}

/**
 * One `pi --mode rpc` process, started as the leader of its own process
 * group so it and anything it starts can be stopped together.
 */
export class PiProcess {
  readonly pid: number;
  readonly rpc: PiRpc;
  /** Resolves once pi has exited and its group is empty. */
  readonly exited: Promise<PiExit>;
  private readonly exitEvent: Promise<[number | null, NodeJS.Signals | null]>;
  private stopping: Promise<PiExit> | undefined;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly timings: StopTimings;

  constructor(child: ChildProcessWithoutNullStreams, handlers: PiHandlers, timings: StopTimings) {
    this.child = child;
    this.timings = timings;
    this.pid = child.pid!;
    handlers.onGroup(this.pid, true);
    this.rpc = new PiRpc(child, {
      onRecord: handlers.onRecord,
      onProtocolError: (message) => console.error(`pi ${this.pid}: ${message}`),
    });
    this.exitEvent = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const closeEvent = once(child, "close");
    this.exited = this.exitEvent.then(async ([code, signal]) => {
      try {
        await drainGroup(this.pid, timings.termGraceMs);
      } catch (error) {
        console.error(`pi ${this.pid} left processes Tondo couldn't stop:`, error);
      }
      handlers.onGroup(this.pid, false);
      const outputGrace = new AbortController();
      await Promise.race([
        closeEvent,
        delay(OUTPUT_GRACE_MS, undefined, { signal: outputGrace.signal }).catch(() => {}),
      ]);
      outputGrace.abort();
      child.stdout.destroy();
      child.stderr.destroy();
      const exit = { code, signal, stderrTail: this.rpc.stderrTail() };
      this.rpc.close(new PiExitError(exit));
      return exit;
    });
  }

  /**
   * Stops pi: close stdin, which is how its rpc.md asks for an orderly
   * shutdown, then SIGTERM its group, then SIGKILL. pi kills its running bash
   * commands on the first two. Their process groups are their own, so SIGKILL
   * leaves them.
   */
  stop(): Promise<PiExit> {
    this.stopping ??= this.runStop();
    return this.stopping;
  }

  private async runStop(): Promise<PiExit> {
    this.child.stdin.end();
    if (!(await this.exitsWithin(this.timings.stdinGraceMs))) {
      signalGroup(this.pid, "SIGTERM");
      if (!(await this.exitsWithin(this.timings.termGraceMs))) signalGroup(this.pid, "SIGKILL");
    }
    return this.exited;
  }

  private async exitsWithin(ms: number): Promise<boolean> {
    const timer = new AbortController();
    const exited = await Promise.race([
      this.exitEvent.then(() => true),
      delay(ms, false, { signal: timer.signal }),
    ]);
    timer.abort();
    return exited;
  }
}

/** Starts pi and resolves once its process is running. */
export async function startPi(
  launch: PiLaunch,
  handlers: PiHandlers,
  timings: StopTimings = STOP_TIMINGS,
): Promise<PiProcess> {
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    await once(child, "spawn");
  } catch (error) {
    throw new Error(
      `Couldn't start pi with ${launch.command} in ${launch.cwd}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }
  return new PiProcess(child, handlers, timings);
}
