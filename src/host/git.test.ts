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

/** A second checkout of the remote, where someone else commits and pushes. Runs Git there. */
function elsewhere(): (...args: string[]) => string {
  const other = path.join(dir, "other");
  native("clone", "-b", "main", remote, other);
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: other,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run("config", "user.name", "Other");
  run("config", "user.email", "other@example.com");
  return run;
}

/** Commits `file` with `text` elsewhere and pushes it to the remote's main. */
function pushedElsewhere(file: string, text: string): string {
  const other = elsewhere();
  writeFileSync(path.join(dir, "other", file), text);
  other("add", file);
  other("commit", "-m", `theirs: ${file}`);
  other("push");
  return other("rev-parse", "HEAD");
}

function stubGh() {
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const file = path.join(bin, "gh");
  writeFileSync(
    file,
    `#!${process.execPath}\nconst fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(path.join(dir, "gh.jsonl"))}, JSON.stringify({args,input:fs.readFileSync(0,'utf8')})+'\\n'); if(process.env.GH_TEST_LOGGED_OUT)process.exit(1); if(args[0]==='pr'&&args[1]==='list')console.log(fs.existsSync(${JSON.stringify(path.join(dir, "created"))})?JSON.stringify([{number:7,title:'A PR',url:'https://github.example.com/team/repo/pull/7',state:'OPEN'}]):'[]'); if(args[1]==='create'&&process.env.GH_TEST_CREATE_FAILS){console.error('GraphQL: something went wrong');process.exit(1);} if(args[1]==='create'){fs.writeFileSync(${JSON.stringify(path.join(dir, "created"))},'yes');console.log('https://github.example.com/team/repo/pull/7');}\n`,
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
  ).toEqual({
    branch: "main",
    upstream: "origin/main",
    ahead: 2,
    behind: 3,
    changes: 2,
    conflicts: 0,
  });
  expect(
    parseGitStatus(
      "# branch.head main\0u UU N... 100644 100644 100644 100644 a b c README.md\x001 .M N... 100644 100644 100644 a a b\0",
    ),
  ).toMatchObject({ changes: 2, conflicts: 1 });
});

it("reports an unresolved merge and refuses to commit its conflict markers", async () => {
  native("switch", "-c", "topic");
  writeFileSync(path.join(cwd, "a"), "topic side");
  native("commit", "-am", "topic");
  native("switch", "main");
  writeFileSync(path.join(cwd, "a"), "main side");
  native("commit", "-am", "main");
  expect(() => native("merge", "topic")).toThrow();
  const head = native("rev-parse", "HEAD");
  expect(await git.status(cwd)).toMatchObject({ conflicts: 1, operation: "merge" });
  await expect(git.act(cwd, { kind: "commit", message: "merge topic" }, "main")).rejects.toThrow(
    "1 path has unresolved conflicts from the merge in progress",
  );
  expect(native("rev-parse", "HEAD")).toBe(head);
  native("merge", "--abort");
  expect(await git.status(cwd)).toMatchObject({ conflicts: 0, operation: null });
});

it("falls back to tracked paths when untracked files overflow the status output", async () => {
  // Status lists an untracked folder once, so the files sit in the root. 23,000
  // names of about 200 bytes make more than 4 MiB of porcelain output.
  for (let i = 0; i < 23_000; i++)
    writeFileSync(path.join(cwd, `${String(i).padStart(5, "0")}${"x".repeat(190)}`), "");
  writeFileSync(path.join(cwd, "a"), "modified");
  const status = await git.status(cwd, false);
  expect(status).toMatchObject({ root: cwd, branch: "main", changes: 1, untrackedHidden: true });
}, 60_000);

it("shows Git's own reason when a push is rejected", async () => {
  writeFileSync(path.join(cwd, "a"), "pushed");
  native("commit", "-am", "pushed");
  native("push");
  native("reset", "--hard", "HEAD~1");
  writeFileSync(path.join(cwd, "a"), "diverged");
  native("commit", "-am", "diverged");
  const push = git.act(cwd, { kind: "push", remote: "origin" }, "main");
  await expect(push).rejects.toThrow("Tondo never force-pushes. git push:");
  await expect(push).rejects.toThrow("rejected");
});

it("pulls by fast-forward, keeps uncommitted changes it doesn't touch, and says what came in", async () => {
  const theirs = pushedElsewhere("b", "theirs");
  writeFileSync(path.join(cwd, "a"), "mine, uncommitted");
  expect(await git.act(cwd, { kind: "pull" }, "main")).toBe("Pulled origin/main into main.");
  expect(native("rev-parse", "HEAD")).toBe(theirs);
  expect(readFileSync(path.join(cwd, "b"), "utf8")).toBe("theirs");
  expect(readFileSync(path.join(cwd, "a"), "utf8")).toBe("mine, uncommitted");
  expect(await git.act(cwd, { kind: "pull" }, "main")).toBe("Already up to date with origin/main.");
});

it("leaves a diverged branch alone, even when pull.rebase asks for a rebase", async () => {
  pushedElsewhere("b", "theirs");
  writeFileSync(path.join(cwd, "c"), "mine");
  native("add", "c");
  native("commit", "-m", "mine");
  native("config", "pull.rebase", "true");
  const head = native("rev-parse", "HEAD");
  // Tondo's hint, then Git's reason without its advice lines.
  await expect(git.act(cwd, { kind: "pull" }, "main")).rejects.toThrow(
    "merge or rebase a diverged branch yourself. git pull: fatal: Not possible to fast-forward, aborting.",
  );
  expect(native("rev-parse", "HEAD")).toBe(head);
  // The fetch still ran, so the branch now knows it's behind.
  expect(await git.status(cwd, false)).toMatchObject({ ahead: 1, behind: 1, operation: null });
});

it("keeps uncommitted changes that a pull would overwrite", async () => {
  pushedElsewhere("a", "theirs");
  writeFileSync(path.join(cwd, "a"), "mine, uncommitted");
  const head = native("rev-parse", "HEAD");
  await expect(git.act(cwd, { kind: "pull" }, "main")).rejects.toThrow("would be overwritten");
  expect(native("rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(path.join(cwd, "a"), "utf8")).toBe("mine, uncommitted");
});

it("refuses to pull without a branch or an upstream", async () => {
  await git.act(cwd, { kind: "create-branch", branch: "topic", base: "main" }, "main");
  await expect(git.act(cwd, { kind: "pull" }, "topic")).rejects.toThrow(
    "topic has no upstream to pull from. Push it to set one.",
  );
  native("switch", "--detach", "main");
  await expect(git.act(cwd, { kind: "pull" }, null)).rejects.toThrow(
    "Switch to a branch before pulling.",
  );
});

it("pulls into a clone of an empty repository, whose branch has no commit yet", async () => {
  const empty = path.join(dir, "empty.git");
  const clone = path.join(dir, "clone");
  native("init", "--bare", "-b", "main", empty);
  native("clone", empty, clone);
  native("push", empty, "main");
  expect(await git.act(clone, { kind: "pull" }, "main")).toBe("Pulled origin/main into main.");
  expect(readFileSync(path.join(clone, "a"), "utf8")).toBe("original");
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
  await git.act(cwd, { kind: "create-branch", branch: "topic/test", base: "main" }, "main");
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

it("creates a branch at the chosen parent rather than the current HEAD", async () => {
  native("switch", "-c", "parent");
  writeFileSync(path.join(cwd, "parent-only"), "parent");
  native("add", ".");
  native("commit", "-m", "parent");
  const parent = native("rev-parse", "HEAD");
  native("switch", "main");
  // A tag with the same name must not override the selected local branch.
  native("tag", "parent", "main");
  await git.act(cwd, { kind: "create-branch", branch: "child", base: "parent" }, "main");
  expect(native("rev-parse", "HEAD")).toBe(parent);
  expect(readFileSync(path.join(cwd, "parent-only"), "utf8")).toBe("parent");
});

it("creates from detached HEAD and from a branch with no commits", async () => {
  native("switch", "--detach", "main");
  const head = native("rev-parse", "HEAD");
  await git.act(cwd, { kind: "create-branch", branch: "attached", base: "HEAD" }, null);
  expect(native("branch", "--show-current")).toBe("attached");
  expect(native("rev-parse", "HEAD")).toBe(head);
  const empty = path.join(dir, "unborn");
  native("init", "-b", "main", empty);
  await git.act(empty, { kind: "create-branch", branch: "first", base: "main" }, "main");
  expect((await git.status(empty, false)).branch).toBe("first");
});

it("keeps the checkout unchanged when a selected parent is missing, unsafe or conflicts with edits", async () => {
  native("switch", "-c", "parent");
  writeFileSync(path.join(cwd, "a"), "parent");
  native("commit", "-am", "parent");
  native("switch", "main");
  writeFileSync(path.join(cwd, "a"), "uncommitted");
  const head = native("rev-parse", "HEAD");
  for (const base of ["missing", "--force", "@{-1}", "main~1", "parent"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- test each refused parent.
    await expect(
      git.act(cwd, { kind: "create-branch", branch: "child", base }, "main"),
    ).rejects.toThrow();
    expect(native("branch", "--list", "child")).toBe("");
    expect(native("branch", "--show-current")).toBe("main");
    expect(native("rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(path.join(cwd, "a"), "utf8")).toBe("uncommitted");
  }
});

it("rejects stale branch actions, revision expressions and option-like branch names", async () => {
  await expect(git.act(cwd, { kind: "commit", message: "wrong" }, "stale")).rejects.toThrow(
    "branch changed",
  );
  for (const branch of ["--force", "@{-1}", "a..b"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- test each rejected input.
    await expect(
      git.act(cwd, { kind: "create-branch", branch, base: "main" }, "main"),
    ).rejects.toThrow();
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
  await git.act(cwd, { kind: "create-branch", branch: "topic", base: "main" }, "main");
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

it("shows gh's own reason when creating a pull request fails", async () => {
  stubGh();
  await git.act(cwd, { kind: "create-branch", branch: "topic", base: "main" }, "main");
  await git.act(cwd, { kind: "push", remote: "origin" }, "topic");
  env.GH_TEST_CREATE_FAILS = "1";
  await expect(
    git.act(
      cwd,
      { kind: "create-pr", remote: "origin", base: "main", title: "A PR", body: "" },
      "topic",
    ),
  ).rejects.toThrow("gh pr: GraphQL: something went wrong");
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
