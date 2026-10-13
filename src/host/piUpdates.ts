import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NO_PI_UPDATES, type PiUpdate, type PiUpdates } from "../shared/piUpdates";
import type { PiMaintenanceContext } from "./piUpdateProbe";
import { drainGroup, signalGroup } from "./processGroup";

const RESULT = "TONDO_PI_UPDATE_RESULT:";

/** Never send registry credentials or an unbounded command failure to the page. */
function redact(message: string): string {
  return message.replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted]@").slice(0, 2000);
}

export function runPiMaintenance(
  context: PiMaintenanceContext,
  reportGroups: (groups: number[]) => void,
  update?: PiUpdate,
  workerFile = path.join(__dirname.replace(/\.asar(?=\/)/, ".asar.unpacked"), "piUpdateProbe.js"),
): Promise<readonly PiUpdate[]> {
  const env: Record<string, string> = {
    ...context.env,
    PATH: `${path.dirname(context.pi.node)}:${context.env.PATH ?? ""}`,
  };
  // These are not session launches. Ambient package/Git overrides must not redirect writes.
  for (const key of [
    "PI_OFFLINE",
    "PI_PACKAGE_DIR",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
  ])
    delete env[key];
  env.GIT_TERMINAL_PROMPT = "0";
  env.PI_CODING_AGENT_DIR = context.agentDir;
  const input = {
    pi: context.pi,
    cwd: context.cwd,
    agentDir: context.agentDir,
    projectTrusted: context.projectTrusted,
    update,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(context.pi.node, [workerFile, JSON.stringify(input)], {
      cwd: context.cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) reportGroups([child.pid]);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      if (child.pid) signalGroup(child.pid, "SIGKILL");
    };
    const deadline = setTimeout(() => stop("pi maintenance exceeded 10 minutes."), 600_000);
    const collect = (chunk: Buffer, error: boolean) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) stop("pi maintenance output exceeded 4 MiB.");
      else (error ? stderr : stdout).push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, true));
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("exit", (code) => {
      if (code !== 0)
        stop(
          redact(
            Buffer.concat(stderr).toString("utf8") ||
              Buffer.concat(stdout).toString("utf8") ||
              `pi maintenance exited with code ${code}.`,
          ),
        );
    });
    child.on("close", () => {
      void (async () => {
        clearTimeout(deadline);
        if (child.pid) await drainGroup(child.pid, 1000);
        reportGroups([]);
        if (failure) throw failure;
        const output = Buffer.concat(stdout);
        if (!isUtf8(output)) throw new Error("pi maintenance output is not UTF-8.");
        const line = output
          .toString("utf8")
          .split("\n")
          .findLast((value) => value.startsWith(RESULT));
        if (!line) throw new Error("pi maintenance returned no result.");
        const entries: unknown = JSON.parse(line.slice(RESULT.length));
        if (!Array.isArray(entries)) throw new Error("pi maintenance returned an invalid result.");
        resolve(entries as PiUpdate[]);
      })().catch(reject);
    });
  });
}

/** Checks never install. Applies accept only an id from the most recently offered inventory. */
export class PiUpdatesService {
  state: PiUpdates = NO_PI_UPDATES;
  private context: PiMaintenanceContext | undefined;
  private readonly changed: (state: PiUpdates) => void;
  private readonly run: typeof runPiMaintenance;
  private readonly reportGroups: (groups: number[]) => void;

  constructor(
    changed: (state: PiUpdates) => void,
    reportGroups: (groups: number[]) => void,
    run = runPiMaintenance,
  ) {
    this.changed = changed;
    this.reportGroups = reportGroups;
    this.run = run;
  }

  private set(patch: Partial<PiUpdates>): void {
    this.state = { ...this.state, ...patch };
    this.changed({
      ...this.state,
      entries: this.state.entries.map((entry) => ({
        ...entry,
        name: redact(entry.name),
        source: redact(entry.source),
        message: entry.message === null ? null : redact(entry.message),
      })),
    });
  }

  async check(context: PiMaintenanceContext, manual: boolean): Promise<void> {
    if (this.state.checking || this.state.applying || (!manual && context.offline)) return;
    this.set({ checking: true, error: null });
    try {
      const entries = await this.run(context, this.reportGroups);
      this.context = context;
      this.set({
        entries: entries.map((entry) => Object.assign({}, entry, { id: randomUUID() })),
        checkedAt: Date.now(),
        project: context.projectTrusted ? context.cwd : null,
      });
    } catch (error) {
      this.context = undefined;
      this.set({
        entries: [],
        error: redact(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      this.set({ checking: false });
    }
  }

  async apply(
    id: string,
    current: PiMaintenanceContext,
    before: () => Promise<void>,
  ): Promise<void> {
    if (this.state.checking || this.state.applying)
      throw new Error("Wait for the current update operation.");
    const entry = this.state.entries.find((item) => item.id === id);
    const context = this.context;
    if (!entry || entry.state !== "available" || !context)
      throw new Error("This update is no longer offered. Check again.");
    if (
      current.pi.cli !== context.pi.cli ||
      current.pi.version !== context.pi.version ||
      current.pi.node !== context.pi.node ||
      current.pi.packageDir !== context.pi.packageDir ||
      current.agentDir !== context.agentDir ||
      ((context.projectTrusted || entry.scope === "project") &&
        (current.cwd !== context.cwd || !current.projectTrusted))
    )
      throw new Error("The pi installation or project changed. Check again before updating.");
    this.set({ applying: id, error: null });
    try {
      await before();
      await this.run(context, this.reportGroups, entry);
      this.set({ entries: this.state.entries.filter((item) => item.id !== id) });
    } catch (error) {
      this.set({ error: redact(error instanceof Error ? error.message : String(error)) });
      throw error;
    } finally {
      this.set({ applying: null });
    }
  }

  setUpdating(updating: boolean): void {
    this.set({ updating });
  }

  failed(error: unknown): void {
    this.set({ error: redact(error instanceof Error ? error.message : String(error)) });
  }

  report(): void {
    this.set({});
  }
}
