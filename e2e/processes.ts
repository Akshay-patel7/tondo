// Finds the processes pi runs, to check what survives a crash or a quit.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export interface Process {
  pid: number;
  pgid: number;
  /** The process as ps listed it: pid, pgid, ppid, state and command. */
  line: string;
}

/** What main exposes to tests in an unpackaged build, in src/main/index.ts. */
interface TondoTest {
  processGroups(): number[];
}

/** The process groups of the pi processes the host has running. */
export function piGroups(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(() =>
    (globalThis as unknown as { tondoTest: TondoTest }).tondoTest.processGroups(),
  );
}

/** Waits until the host runs exactly one pi, and returns its process group, which is pi's pid. */
export async function piGroup(app: ElectronApplication): Promise<number> {
  await expect.poll(() => piGroups(app)).toHaveLength(1);
  const [group] = await piGroups(app);
  if (group === undefined) throw new Error("pi stopped running");
  return group;
}

/**
 * Every live process. One that is exiting (macOS's state E) or has exited but
 * not been reaped yet (state Z) doesn't count.
 */
export function allProcesses(): Process[] {
  const output = execFileSync(
    "ps",
    ["-A", "-o", "pid=", "-o", "pgid=", "-o", "ppid=", "-o", "stat=", "-o", "command="],
    { encoding: "utf8" },
  );
  return output.split("\n").flatMap((raw) => {
    const line = raw.trim();
    const [pid, pgid, , stat] = line.split(/\s+/);
    if (!line || stat === undefined || /^[EZ]/.test(stat)) return [];
    return [{ pid: Number(pid), pgid: Number(pgid), line }];
  });
}

export function processesIn(groups: readonly number[]): Process[] {
  return allProcesses().filter(({ pgid }) => groups.includes(pgid));
}

/** Writes process lists to the test's output folder, for the stage report. */
export function reportProcesses(file: string, lists: Record<string, Process[]>): void {
  const text = Object.entries(lists)
    .map(([title, list]) =>
      [`${title}: PID PGID PPID STAT COMMAND`, ...list.map(({ line }) => line)].join("\n"),
    )
    .join("\n\n");
  writeFileSync(test.info().outputPath(file), `${text}\n`);
}
