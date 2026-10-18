import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it } from "vitest";
import { threadFromMessages, type PiMessage, type ThreadState } from "../shared/thread";
import { agentCheckout, toolDirectory } from "./agentCheckout";
import { Git } from "./git";
import { GitCommands } from "./gitCommand";

it.each([
  ["cd /work/topic && pnpm test", "/work/topic"],
  ["cd -- '../topic tree' && pwd", "/work/topic tree"],
  ['cd "/work/topic tree" && pwd', "/work/topic tree"],
  ["cd /work/topic\\ tree && pwd", "/work/topic tree"],
  ["cd '/work/it'\\''s' && pwd", "/work/it's"],
  ["git -C '../topic tree' status", "/work/topic tree"],
  ["pnpm test", "/work/project"],
  ['cd "$TREE" && pwd', null],
  ["cd $(touch /tmp/not-executed) && pwd", null],
  ["cd ~/topic && pwd", null],
  ["cd /work/topic || pwd", null],
  ["cd /work/topic; pwd", null],
  ["cd /work/project && cd ../topic && pwd", "/work/topic"],
  ["cd /work/project && git -C ../topic status", "/work/topic"],
  ["cd /work/topic && pwd && cd /elsewhere && pwd", null],
  ["echo hi && cd /work/topic && pwd", null],
  ["git -C /work/topic -C subdir status", null],
  ["cd '/unclosed && pwd", null],
])("reads only literal checkout evidence in %s", (command, expected) => {
  expect(toolDirectory("bash", { command }, "/work/project")).toBe(expected);
});

it("resolves built-in file tool paths relative to pi's actual starting folder", () => {
  for (const name of ["read", "edit", "write"]) {
    expect(toolDirectory(name, { path: "../topic/file.ts" }, "/work/project")).toBe(
      "/work/topic/file.ts",
    );
  }
  expect(toolDirectory("custom", { path: "/work/topic/file.ts" }, "/work/project")).toBeNull();
});

let dir: string;
let cwd: string;
let tree: string;
let git: Git;
let env: Record<string, string>;
const native = (folder: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: folder, env, stdio: "pipe" });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-agent-checkout-")));
  cwd = path.join(dir, "project");
  tree = path.join(dir, "agent's worktree");
  mkdirSync(cwd);
  env = {
    PATH: process.env.PATH!,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  native(cwd, "init", "-b", "main");
  native(cwd, "config", "user.name", "Test");
  native(cwd, "config", "user.email", "test@example.com");
  writeFileSync(path.join(cwd, "file.ts"), "original\n");
  native(cwd, "add", ".");
  native(cwd, "-c", "commit.gpgsign=false", "commit", "-m", "initial");
  native(cwd, "worktree", "add", "-b", "agent/topic", tree);
  git = new Git(new GitCommands(async () => env));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function transcript(
  name: string,
  args: Parameters<typeof fauxToolCall>[1],
  isError = false,
  id = "call-1",
): PiMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall(name, args, { id })),
    {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [],
      isError,
      timestamp: 1,
    },
  ];
}
function activity(state: ThreadState) {
  return agentCheckout(git, cwd, cwd, state);
}
function used(command: string) {
  return threadFromMessages(transcript("bash", { command }));
}

it("follows a used worktree, rereads its branch and restores from the transcript", async () => {
  const command = `git -C "${tree}" status`;
  expect(await activity(used(command))).toEqual({ root: tree, branch: "agent/topic" });
  native(tree, "switch", "-c", "agent/renamed");
  expect(await activity(used(command))).toEqual({ root: tree, branch: "agent/renamed" });
  native(tree, "checkout", "--detach");
  expect(await activity(used(command))).toEqual({ root: tree, branch: null });
  expect(native(cwd, "branch", "--show-current").toString().trim()).toBe("main");
});

it("doesn't infer ownership or activity from a worktree merely existing or being created", async () => {
  expect(await activity(threadFromMessages([]))).toBeNull();
  expect(await activity(used(`git worktree add -b other "${tree}"`))).toBeNull();
  expect(
    await activity(
      threadFromMessages(transcript("bash", { command: `cd "${tree}" && pwd` }, true)),
    ),
  ).toBeNull();
});

it("tracks file tools and returns to the real starting checkout for relative tools", async () => {
  const prior = transcript("read", { path: path.join(tree, "file.ts") });
  expect(await activity(threadFromMessages(prior))).toEqual({ root: tree, branch: "agent/topic" });
  const current = transcript("read", { path: "file.ts" }, false, "call-2");
  expect(await activity(threadFromMessages([...prior, ...current]))).toBeNull();
});

it("keeps the last successful location after a failed tool and ignores unexecuted calls", async () => {
  const prior = transcript("read", { path: path.join(tree, "file.ts") });
  const failed = transcript("read", { path: "missing.ts" }, true, "failed");
  const proposed = fauxAssistantMessage(
    fauxToolCall("bash", { command: "pwd" }, { id: "proposed" }),
  );
  expect(await activity(threadFromMessages([...prior, ...failed, proposed]))).toEqual({
    root: tree,
    branch: "agent/topic",
  });
});

it("shows a running tool, but refuses to pick one of two simultaneous checkout locations", async () => {
  const message = fauxAssistantMessage([
    fauxToolCall("bash", { command: `cd "${tree}" && pnpm test` }, { id: "one" }),
    fauxToolCall("bash", { command: "pwd" }, { id: "two" }),
  ]);
  const state = threadFromMessages([message]);
  const run = { partial: null, result: null, isError: false };
  expect(await activity({ ...state, tools: { one: run } })).toEqual({
    root: tree,
    branch: "agent/topic",
  });
  expect(await activity({ ...state, tools: { one: run, two: run } })).toBeNull();
});

it("rejects foreign repositories, missing worktrees and unsupported dynamic shell paths", async () => {
  const other = path.join(dir, "other");
  mkdirSync(other);
  native(other, "init");
  expect(await activity(used(`git -C "${other}" status`))).toBeNull();
  expect(await activity(used('cd "$TREE" && pwd'))).toBeNull();
  const state = used(`cd "${tree}" && pwd`);
  rmSync(tree, { recursive: true });
  expect(await activity(state)).toBeNull();
});

it("resolves symlinks before attribution and doesn't label a project's own subdirectory as another worktree", async () => {
  const alias = path.join(dir, "alias");
  symlinkSync(tree, alias);
  expect(await activity(used(`cd "${alias}" && pwd`))).toEqual({
    root: tree,
    branch: "agent/topic",
  });
  const subdir = path.join(cwd, "src");
  mkdirSync(subdir);
  expect(await agentCheckout(git, subdir, cwd, used(`cd "${cwd}" && pwd`))).toBeNull();
});
