import { execFileSync } from "node:child_process";
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
import { Git, githubRepository, parseGitStatus } from "./git";
import { GitCommands } from "./gitCommand";

let dir: string;
let cwd: string;
let remote: string;
let env: Record<string, string>;
let git: Git;
const native = (...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-git-")));
  cwd = path.join(dir, "project");
  remote = path.join(dir, "remote.git");
  mkdirSync(cwd);
  env = {
    PATH: process.env.PATH!,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  native("init", "-b", "main");
  native("config", "user.name", "Test");
  native("config", "user.email", "test@example.com");
  writeFileSync(path.join(cwd, "a"), "original");
  native("add", ".");
  native("commit", "-m", "initial");
  native("init", "--bare", remote);
  native("remote", "add", "origin", remote);
  native("push", "-u", "origin", "main");
  git = new Git(new GitCommands(async () => env));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function stubGh() {
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const file = path.join(bin, "gh");
  writeFileSync(
    file,
    `#!${process.execPath}\nconst fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(path.join(dir, "gh.jsonl"))}, JSON.stringify({args,input:fs.readFileSync(0,'utf8')})+'\\n'); if(process.env.GH_TEST_LOGGED_OUT)process.exit(1); if(args[0]==='pr'&&args[1]==='list')console.log(fs.existsSync(${JSON.stringify(path.join(dir, "created"))})?JSON.stringify([{number:7,title:'A PR',url:'https://github.example.com/team/repo/pull/7',state:'OPEN'}]):'[]'); if(args[1]==='create'){fs.writeFileSync(${JSON.stringify(path.join(dir, "created"))},'yes');console.log('https://github.example.com/team/repo/pull/7');}\n`,
  );
  chmodSync(file, 0o755);
  env.PATH = `${bin}:${env.PATH}`;
  native("remote", "set-url", "origin", "git@github.example.com:team/repo.git");
  native("remote", "set-url", "--push", "origin", remote);
  // ls-remote uses the fetch URL. Keep every Git network operation inside the fixture too.
  native("config", `url.${remote}.insteadOf`, "git@github.example.com:team/repo.git");
}

it("parses NUL records without interpreting a renamed or untracked filename as a header", () => {
  expect(
    parseGitStatus(
      "# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\x002 R. N... 1 1 1 a b R100 new\0# branch.head wrong\0? line\nbreak\0",
    ),
  ).toEqual({ branch: "main", upstream: "origin/main", ahead: 2, behind: 3, changes: 2 });
});

it("reads status without writing the index, and handles non-repos and detached HEAD", async () => {
  const index = readFileSync(path.join(cwd, ".git/index"));
  writeFileSync(path.join(cwd, "a"), "modified");
  const status = await git.status(cwd);
  expect(status).toMatchObject({
    root: cwd,
    branch: "main",
    branches: ["main"],
    changes: 1,
    remote: "origin",
  });
  expect(readFileSync(path.join(cwd, ".git/index"))).toEqual(index);
  expect((await git.status(dir)).root).toBeNull();
  native("checkout", "--detach");
  expect((await git.status(cwd)).branch).toBeNull();
});

it("creates/switches branches, commits all changes with the literal message and pushes only when asked", async () => {
  await git.act(cwd, { kind: "create-branch", branch: "topic/test" }, "main");
  writeFileSync(path.join(cwd, "new\nfile"), "new");
  await git.act(cwd, { kind: "commit", message: "fix: literal $(touch nope)" }, "topic/test");
  expect(native("log", "-1", "--format=%s")).toBe("fix: literal $(touch nope)");
  expect(native("ls-remote", "--heads", "origin", "topic/test")).toBe("");
  await git.act(cwd, { kind: "push", remote: "origin" }, "topic/test");
  expect(native("ls-remote", "--heads", "origin", "topic/test")).toContain(
    native("rev-parse", "HEAD"),
  );
  await git.act(cwd, { kind: "switch", branch: "main" }, "topic/test");
  expect((await git.status(cwd)).branch).toBe("main");
});

it("rejects stale branch actions, revision expressions and option-like branch names", async () => {
  await expect(git.act(cwd, { kind: "commit", message: "wrong" }, "stale")).rejects.toThrow(
    "branch changed",
  );
  for (const branch of ["--force", "@{-1}", "a..b"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- test each rejected input.
    await expect(git.act(cwd, { kind: "create-branch", branch }, "main")).rejects.toThrow();
  }
  expect(native("branch", "--show-current")).toBe("main");
});

it("preserves conflicting dirty changes rather than forcing a checkout", async () => {
  native("switch", "-c", "other");
  writeFileSync(path.join(cwd, "a"), "other");
  native("commit", "-am", "other");
  native("switch", "main");
  writeFileSync(path.join(cwd, "a"), "uncommitted");
  await expect(git.act(cwd, { kind: "switch", branch: "other" }, "main")).rejects.toThrow();
  expect(readFileSync(path.join(cwd, "a"), "utf8")).toBe("uncommitted");
});

it("uses the remote's Enterprise host, requires a push, and creates/reads a PR through gh", async () => {
  stubGh();
  await git.act(cwd, { kind: "create-branch", branch: "topic" }, "main");
  const action = {
    kind: "create-pr",
    remote: "origin",
    base: "main",
    title: "A PR",
    body: "Only this text.",
  } as const;
  await expect(git.act(cwd, action, "topic")).rejects.toThrow("Push this branch first");
  await git.act(cwd, { kind: "push", remote: "origin" }, "topic");
  await git.act(cwd, action, "topic");
  expect((await git.status(cwd)).github.pr).toMatchObject({ number: 7, state: "OPEN" });
  const calls = readFileSync(path.join(dir, "gh.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls).toContainEqual({
    args: ["auth", "status", "--active", "--hostname", "github.example.com"],
    input: "",
  });
  expect(calls).toContainEqual({
    args: [
      "pr",
      "create",
      "--repo",
      "github.example.com/team/repo",
      "--head",
      "topic",
      "--base",
      "main",
      "--title",
      "A PR",
      "--body-file",
      "-",
    ],
    input: "Only this text.",
  });
});

it("reports missing and logged-out gh without exposing command output", async () => {
  stubGh();
  env.GH_TEST_LOGGED_OUT = "1";
  expect((await git.status(cwd)).github.state).toBe("logged-out");
  delete env.GH_TEST_LOGGED_OUT;
  // A PATH with only Git, so this doesn't depend on the developer's installed gh.
  const bin = path.join(dir, "only-git");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh\nexec ${execFileSync("which", ["git"], { encoding: "utf8" }).trim()} "$@"\n`,
  );
  chmodSync(path.join(bin, "git"), 0o755);
  env.PATH = bin;
  expect((await git.status(cwd, true, true)).github.state).toBe("missing");
});

it("parses remote URLs without leaking passwords and rejects local paths", () => {
  expect(githubRepository("https://user:secret@github.example.com/team/repo.git")).toEqual({
    host: "github.example.com",
    repo: "team/repo",
  });
  expect(githubRepository("ssh://git@github.example.com/team/repo.git")).toEqual({
    host: "github.example.com",
    repo: "team/repo",
  });
  expect(githubRepository(remote)).toBeNull();
});
