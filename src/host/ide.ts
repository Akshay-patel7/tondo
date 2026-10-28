import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { IDE_PRESETS, ideLabel, isIdeCommand } from "../shared/ide";

/** Absolute checkout paths stay one argument, including spaces and shell punctuation. */
export function ideLaunch(command: string, cwd: string, platform: NodeJS.Platform) {
  if (!isIdeCommand(command)) throw new Error("Choose an IDE executable in Settings > Threads.");
  const preset = IDE_PRESETS.find((item) => item.command === command);
  return platform === "darwin" && preset
    ? { command: "/usr/bin/open", args: ["-a", preset.macApp, cwd] }
    : { command, args: [cwd] };
}

/** The IDE belongs to the user and stays open after Tondo quits. Never invoke a shell. */
export async function openIde(
  command: string,
  cwd: string,
  env: Record<string, string>,
  failed: (error: Error) => void,
): Promise<void> {
  if (!(await stat(cwd)).isDirectory())
    throw new Error(`The thread's folder isn't a directory: ${cwd}`);
  const launch = ideLaunch(command, cwd, process.platform);
  const problem = (detail: string) =>
    new Error(
      `Couldn't open ${ideLabel(command)} in ${cwd}: ${detail}. Check the IDE in Settings > Threads.`,
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { cwd, env, detached: true, stdio: "ignore" });
    child.once("error", (error) => reject(problem(error.message)));
    child.once("exit", (code, signal) => {
      if (code !== 0) failed(problem(`launcher exited with ${signal ?? code}`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
