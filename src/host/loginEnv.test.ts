import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureLoginEnv } from "./loginEnv";
import { signalGroup } from "./processGroup";

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-login-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** An environment like the host's, with bash as the login shell and `profile` as its startup file. */
function inheritedWith(profile: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  writeFileSync(path.join(home, ".bash_profile"), profile);
  return { HOME: home, SHELL: "/bin/bash", PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", ...extra };
}

describe("captureLoginEnv", () => {
  it("keeps what the startup files export", async () => {
    const inherited = inheritedWith(
      [
        "echo 'noise on stdout'",
        "echo 'noise on stderr' >&2",
        "export ANTHROPIC_API_KEY=sk-test",
        "export TWO_LINES=$'first\\nsecond'",
        'export PATH="$HOME/bin:$PATH"',
      ].join("\n"),
    );
    const { env, problem } = await captureLoginEnv(inherited, "linux");
    expect(problem).toBeUndefined();
    expect(env).toMatchObject({
      HOME: home,
      ANTHROPIC_API_KEY: "sk-test",
      TWO_LINES: "first\nsecond",
    });
    expect(env.PATH!.split(":")[0]).toBe(path.join(home, "bin"));
  });

  it("drops Electron's variables and the capture run's own", async () => {
    const inherited = inheritedWith("", {
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      XDG_CURRENT_DESKTOP: "Unity",
      ORIGINAL_XDG_CURRENT_DESKTOP: "GNOME",
    });
    const { env, problem } = await captureLoginEnv(inherited, "linux");
    expect(problem).toBeUndefined();
    expect(env.XDG_CURRENT_DESKTOP).toBe("GNOME");
    for (const name of [
      "ELECTRON_RUN_AS_NODE",
      "ELECTRON_NO_ATTACH_CONSOLE",
      "ORIGINAL_XDG_CURRENT_DESKTOP",
      "PWD",
      "SHLVL",
      "_",
    ]) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it.runIf(process.platform === "darwin")(
    "gives macOS a UTF-8 LC_CTYPE when nothing sets a locale",
    async () => {
      const none = await captureLoginEnv(inheritedWith("", { LANG: undefined }), "darwin");
      expect(none.env).toMatchObject({ LC_CTYPE: "en_US.UTF-8" });
      expect(none.env).not.toHaveProperty("LANG");
      const shells = await captureLoginEnv(
        inheritedWith("export LANG=fr_FR.UTF-8", { LANG: undefined }),
        "darwin",
      );
      expect(shells.env.LANG).toBe("fr_FR.UTF-8");
      expect(shells.env).not.toHaveProperty("LC_CTYPE");
    },
  );

  it("falls back to the inherited environment when the shell doesn't exist", async () => {
    const inherited = inheritedWith("", { SHELL: "/nonexistent/shell", ELECTRON_RUN_AS_NODE: "1" });
    const { env, problem } = await captureLoginEnv(inherited, "linux");
    expect(problem).toBe("/nonexistent/shell -ilc: spawn /nonexistent/shell ENOENT");
    expect(env).toEqual({
      HOME: home,
      SHELL: "/nonexistent/shell",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
    });
  });

  it("falls back when the shell prints no environment", async () => {
    const { env, problem } = await captureLoginEnv(
      inheritedWith("", { SHELL: "/usr/bin/true" }),
      "linux",
    );
    expect(problem).toBe("/usr/bin/true -ilc: exited with code 0 and printed no environment");
    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  it.runIf(process.platform === "darwin")(
    "puts launchd's PATH first when it falls back on macOS",
    async () => {
      const launchd = execFileSync("/bin/launchctl", ["getenv", "PATH"], {
        encoding: "utf8",
      }).trim();
      const { env } = await captureLoginEnv(
        inheritedWith("", { SHELL: "/nonexistent/shell" }),
        "darwin",
      );
      const entries = [...(launchd ? launchd.split(":") : []), "/usr/bin", "/bin"];
      expect(env.PATH).toBe([...new Set(entries)].join(":"));
    },
  );

  it("stops a shell that doesn't finish in time, and falls back", async () => {
    const inherited = inheritedWith('echo $$ > "$HOME/shell.pid"\nsleep 60');
    const { env, problem } = await captureLoginEnv(inherited, "linux", 1_000);
    expect(problem).toMatch(/^\/bin\/bash -ilc: printed no environment within 1000 ms/);
    expect(env.PATH).toBe("/usr/bin:/bin");
    // The shell led its own group, and nothing in it is left.
    const shell = Number(readFileSync(path.join(home, "shell.pid"), "utf8"));
    expect(signalGroup(shell, 0)).toBe(false);
  });
});
