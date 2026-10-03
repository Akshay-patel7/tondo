import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { drainGroup, signalGroup } from "./processGroup";

export class GitCommandError extends Error {
  readonly code: number | string | null;
  readonly detail: string;
  constructor(command: string, code: number | string | null, detail: string) {
    super(
      `${command}: ${detail.replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted]@").slice(0, 2_000)}`,
    );
    this.code = code;
    this.detail = detail;
  }
}

/** Bound hooks, filters and credential helpers too, and let main reap them if the host dies. */
export class GitCommands {
  private readonly groups = new Set<number>();

  private readonly environment: () => Promise<Record<string, string>>;
  private readonly reportGroups: (groups: number[]) => void;
  constructor(
    environment: () => Promise<Record<string, string>>,
    reportGroups: (groups: number[]) => void = () => {},
  ) {
    this.environment = environment;
    this.reportGroups = reportGroups;
  }

  async run(
    command: "git" | "gh",
    cwd: string,
    args: readonly string[],
    input?: string,
  ): Promise<string> {
    const env: NodeJS.ProcessEnv = { ...(await this.environment()) };
    for (const key of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_NAMESPACE",
      "GIT_PREFIX",
      "GH_REPO",
      "GH_HOST",
      "GH_DEBUG",
    ])
      delete env[key];
    Object.assign(env, {
      LC_ALL: "C",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      GH_PAGER: "cat",
    });
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd, env, detached: true, stdio: "pipe" });
      if (child.pid) {
        this.groups.add(child.pid);
        this.reportGroups([...this.groups]);
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let failure: GitCommandError | undefined;
      const stop = (error: GitCommandError) => {
        failure ??= error;
        if (child.pid) signalGroup(child.pid, "SIGKILL");
      };
      const label = `${command} ${args[0] ?? ""}`;
      const deadline = setTimeout(
        () => stop(new GitCommandError(label, null, "exceeded 60 seconds")),
        60_000,
      );
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) stop(new GitCommandError(label, null, "output exceeded 4 MiB"));
        else chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error: NodeJS.ErrnoException) => {
        failure ??= new GitCommandError(label, error.code ?? null, error.message);
      });
      child.on("exit", (code, signal) => {
        if (code !== 0)
          stop(
            new GitCommandError(
              label,
              code,
              Buffer.concat(stderr).toString("utf8").trim() || `exited with ${signal ?? code}`,
            ),
          );
      });
      const finish = async () => {
        clearTimeout(deadline);
        if (child.pid) {
          await drainGroup(child.pid, 1000);
          this.groups.delete(child.pid);
          this.reportGroups([...this.groups]);
        }
        if (failure) throw failure;
        const output = Buffer.concat(stdout);
        if (!isUtf8(output)) throw new GitCommandError(label, null, "output is not UTF-8");
        resolve(output.toString("utf8"));
      };
      child.on("close", () => {
        void finish().catch(reject);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
}
