import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GitCommandError, GitCommands } from "./gitCommand";

let dir: string;
let bin: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-git-command-")));
  bin = path.join(dir, "bin");
  mkdirSync(bin);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function executable(source: string): void {
  const file = path.join(bin, "git");
  writeFileSync(file, `#!${process.execPath}\n${source}\n`);
  chmodSync(file, 0o755);
}

it("passes literal arguments/input, strips inherited repository routing and reports process groups", async () => {
  executable(
    "console.log(JSON.stringify({args:process.argv.slice(2),env:process.env,input:require('fs').readFileSync(0,'utf8')}))",
  );
  const groups: number[][] = [];
  const commands = new GitCommands(
    async () => ({
      PATH: bin,
      GIT_DIR: "/wrong",
      GIT_WORK_TREE: "/wrong",
      GIT_INDEX_FILE: "/wrong",
      GH_REPO: "wrong/repo",
      GH_HOST: "wrong.example.com",
    }),
    (value) => groups.push(value),
  );
  const result = JSON.parse(
    await commands.run("git", dir, ["commit", "$(touch nope)"], "literal input"),
  );
  expect(result.args).toEqual(["commit", "$(touch nope)"]);
  expect(result.input).toBe("literal input");
  expect(result.env).toMatchObject({
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  });
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GH_REPO", "GH_HOST"])
    expect(result.env).not.toHaveProperty(key);
  expect(groups[0]).toHaveLength(1);
  expect(groups.at(-1)).toEqual([]);
});

it("bounds output and reaps a helper that inherited the command's process group", async () => {
  const pidFile = path.join(dir, "helper.pid");
  const helper = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.send('ready');setInterval(()=>{},1000);`;
  executable(
    `const {spawn}=require('child_process');const helper=spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:['ignore','inherit','inherit','ipc']});helper.on('message',()=>{process.stdout.write(Buffer.alloc(5*1024*1024,65));});`,
  );
  const groups: number[][] = [];
  const commands = new GitCommands(
    async () => ({ PATH: bin }),
    (value) => groups.push(value),
  );
  await expect(commands.run("git", dir, ["status"])).rejects.toThrow("output exceeded 4 MiB");
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
  expect(groups.at(-1)).toEqual([]);
});

it("does not put embedded remote credentials in a displayed command error", () => {
  const error = new GitCommandError(
    "git push",
    1,
    "fatal: https://user:password@github.example.com/team/repo failed",
  );
  expect(error.message).toContain("https://[redacted]@github.example.com");
  expect(error.message).not.toContain("password");
});
