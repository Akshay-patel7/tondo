import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { drainGroup, signalGroup } from "./processGroup";

/**
 * Perl that keeps its group forking: eight processes that each fork a child
 * and exit, over and over, ignoring SIGTERM. It stops by itself after 10 s.
 */
const FORKING =
  '$SIG{TERM} = "IGNORE"; my $start = time; $| = 1; print "ready\\n";' +
  " for (1..7) { last unless fork(); }" +
  " while (time - $start < 10) { exit 0 if fork(); }";

/**
 * Starts `program`, node unless a test picks another, running `script` as
 * the leader of a new process group, and resolves once the script has
 * printed its first line.
 */
async function startGroup(script: string, program = process.execPath) {
  const leader = spawn(program, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  leader.stdout.setEncoding("utf8");
  const [line] = (await once(leader.stdout, "data")) as [string];
  return { leader, pgid: leader.pid!, line: line.trim() };
}

describe("drainGroup", () => {
  it("stops a group with SIGTERM", async () => {
    const { leader, pgid } = await startGroup(
      "console.log('ready'); setInterval(() => {}, 60_000)",
    );
    const exit = once(leader, "exit");
    await drainGroup(pgid, 5_000);
    expect(await exit).toEqual([null, "SIGTERM"]);
    expect(signalGroup(pgid, 0)).toBe(false);
  });

  it("kills a group that ignores SIGTERM once the grace runs out", async () => {
    const { leader, pgid } = await startGroup(
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 60_000)",
    );
    const exit = once(leader, "exit");
    await drainGroup(pgid, 100);
    expect(await exit).toEqual([null, "SIGKILL"]);
    expect(signalGroup(pgid, 0)).toBe(false);
  });

  // On macOS, one SIGKILL misses a child forked while it goes out.
  it("kills a group whose processes keep forking", async () => {
    const { pgid } = await startGroup(FORKING, "perl");
    await drainGroup(pgid, 1_000);
    expect(signalGroup(pgid, 0)).toBe(false);
  });

  it("stops what's left in a group after its leader exits", async () => {
    // The leader starts a child in the same group, prints the child's pid, and exits.
    const { leader, pgid, line } = await startGroup(
      "const child = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });" +
        "child.unref(); console.log(child.pid);",
    );
    await once(leader, "exit");
    const orphan = Number(line);
    expect(signalGroup(pgid, 0)).toBe(true);
    await drainGroup(pgid, 5_000);
    expect(signalGroup(pgid, 0)).toBe(false);
    // A stopped group may still contain an exited PID waiting for init to reap it.
    await expect
      .poll(() => {
        try {
          process.kill(orphan, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          throw error;
        }
      })
      .toBe(false);
  });

  // macOS answers EPERM when a group holds only exited processes nobody has
  // reaped yet. Linux signals them until they're reaped.
  it.runIf(process.platform === "darwin")(
    "treats a group of unreaped exited processes as stopped",
    async () => {
      // Perl forks a child into its own group, waits for it to exit, and
      // prints its pid without reaping it.
      const holder = spawn(
        "perl",
        [
          "-e",
          "my $exited = 0; $SIG{CHLD} = sub { $exited = 1 };" +
            "my $pid = fork(); if ($pid == 0) { setpgrp(0, 0); exit 0 }" +
            '$| = 1; sleep 1 until $exited; print "$pid\\n"; sleep 60',
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      try {
        holder.stdout.setEncoding("utf8");
        const [line] = (await once(holder.stdout, "data")) as [string];
        const pgid = Number(line.trim());
        expect(() => process.kill(-pgid, 0)).toThrow("EPERM");
        // A positive-PID probe still succeeds for this zombie. It isn't proof of a live helper.
        expect(() => process.kill(pgid, 0)).not.toThrow();
        expect(signalGroup(pgid, 0)).toBe(false);
        await drainGroup(pgid, 100);
      } finally {
        holder.kill();
      }
    },
  );
});
