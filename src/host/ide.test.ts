import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDE_PRESETS, isIdeCommand } from "../shared/ide";
import { ideLaunch, openIde } from "./ide";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ stat: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("IDE launch", () => {
  it.each(IDE_PRESETS)("opens $label through its macOS app or Linux CLI", ({ command, macApp }) => {
    const cwd = "/work/a folder; $(do-not-run)";
    expect(ideLaunch(command, cwd, "darwin")).toEqual({
      command: "/usr/bin/open",
      args: ["-a", macApp, cwd],
    });
    expect(ideLaunch(command, cwd, "linux")).toEqual({ command, args: [cwd] });
  });

  it("keeps custom executable paths literal on both platforms", () => {
    for (const platform of ["darwin", "linux"] as const)
      expect(ideLaunch("/opt/My IDE/editor", "/work/repo", platform)).toEqual({
        command: "/opt/My IDE/editor",
        args: ["/work/repo"],
      });
    for (const command of ["code --wait", "./code", "../code", "-editor", "", "editor\nextra"])
      expect(isIdeCommand(command)).toBe(false);
  });

  it("detaches the IDE with the login environment, no shell, and reports a failing launcher", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    const spawning = new Promise<void>((resolve) => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        resolve();
        return child as never;
      });
    });
    const failed = vi.fn();
    const env = { HOME: "/scratch/home", PATH: "/scratch/bin" };
    const opened = openIde("/opt/My IDE/editor", "/work/folder's name", env, failed);
    await spawning;
    child.emit("spawn");
    await opened;
    expect(spawn).toHaveBeenCalledWith("/opt/My IDE/editor", ["/work/folder's name"], {
      cwd: "/work/folder's name",
      env,
      detached: true,
      stdio: "ignore",
    });
    expect(child.unref).toHaveBeenCalledOnce();
    child.emit("exit", 1, null);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("launcher exited with 1") }),
    );
  });

  it("reports missing executables and refuses missing or non-directory checkouts", async () => {
    vi.mocked(stat).mockRejectedValueOnce(new Error("folder missing"));
    await expect(openIde("code", "/missing", {}, vi.fn())).rejects.toThrow("folder missing");
    vi.mocked(stat).mockResolvedValueOnce({ isDirectory: () => false } as never);
    await expect(openIde("code", "/file", {}, vi.fn())).rejects.toThrow("isn't a directory");
    expect(spawn).not.toHaveBeenCalled();

    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    const spawning = new Promise<void>((resolve) => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        resolve();
        return child as never;
      });
    });
    const opened = expect(openIde("no-such-ide", "/work", {}, vi.fn())).rejects.toThrow("ENOENT");
    await spawning;
    child.emit("error", new Error("ENOENT"));
    await opened;
  });
});
