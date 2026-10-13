import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Git } from "./git";
import { GitCommands } from "./gitCommand";
import { Store } from "./store";
import { Worktrees } from "./worktrees";
import { sessionFolder } from "./sessionFolder";

const CREATED_AT = 1_700_000_000_000;
const owner = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let dir: string;
let cwd: string;
let git: Git;
let store: Store;
let worktrees: Worktrees;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-worktrees-")));
  cwd = path.join(dir, "project");
  mkdirSync(cwd);
  const env = {
    PATH: process.env.PATH!,
    HOME: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = (...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "pipe" });
  run("init", "-b", "main");
  run("config", "user.name", "Test");
  run("config", "user.email", "test@example.com");
  writeFileSync(path.join(cwd, ".gitignore"), "ignored\n");
  writeFileSync(path.join(cwd, "a"), "original");
  run("add", ".");
  run("commit", "-m", "initial");
  git = new Git(new GitCommands(async () => env));
  store = Store.open(":memory:");
  worktrees = new Worktrees(path.join(dir, "managed"), store, git);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

it("creates an isolated worktree and distinct default session folder; removal keeps its branch", async () => {
  const worktree = await worktrees.create(cwd, owner(1), "topic/test", "HEAD");
  expect((await git.status(worktree.path)).branch).toBe("topic/test");
  expect((await git.status(cwd)).branch).toBe("main");
  const env = { HOME: dir, PI_CODING_AGENT_DIR: path.join(dir, "agent") };
  expect(sessionFolder(worktree.path, [], env).dir).not.toBe(sessionFolder(cwd, [], env).dir);
  expect(worktrees.forThread(worktree.threadId)).toEqual(worktree);
  await worktrees.remove(worktree, false);
  expect(existsSync(worktree.path)).toBe(false);
  expect((await git.status(cwd)).branches).toContain("topic/test");
  expect(store.worktrees()).toEqual([]);
});

it("creates in a custom folder and keeps ownership across directory changes and restart", async () => {
  const defaultTree = await worktrees.create(cwd, owner(15), "default", "HEAD");
  const customRoot = path.join(dir, "custom folder", "nested");
  const custom = await worktrees.create(cwd, owner(16), "custom", "HEAD", customRoot);
  expect(custom.path).toBe(path.join(customRoot, owner(16)));
  expect(custom.root).toBe(customRoot);
  const another = await worktrees.create(
    cwd,
    owner(17),
    "another",
    "HEAD",
    path.join(dir, "another"),
  );

  // A fresh manager still removes both old and new locations from the saved ledger.
  worktrees = new Worktrees(path.join(dir, "managed"), store, git);
  await worktrees.remove(worktrees.forThread(defaultTree.threadId)!, false);
  await worktrees.remove(worktrees.forThread(custom.threadId)!, false);
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages).toEqual([]);
  expect(store.worktrees()).toEqual([]);
  expect(existsSync(another.path)).toBe(false);
  expect(existsSync(customRoot)).toBe(true);
});

it("records the canonical custom root even when the chosen folder is a symlink", async () => {
  const root = path.join(dir, "real-root");
  const link = path.join(dir, "chosen-link");
  mkdirSync(root);
  symlinkSync(root, link);
  const created = await worktrees.create(cwd, owner(22), "linked-root", "HEAD", link);
  expect(created.root).toBe(root);
  expect(path.dirname(created.path)).toBe(root);
  await worktrees.remove(created, false);
});

it("keeps an empty abandoned folder when its parent was replaced with a symlink", async () => {
  const root = path.join(dir, "custom");
  const threadId = owner(23);
  const folder = path.join(root, threadId);
  mkdirSync(folder, { recursive: true });
  store.addWorktree({ root, path: folder, repository: cwd, branch: "interrupted", threadId });
  renameSync(root, path.join(dir, "moved-root"));
  const foreign = path.join(dir, "foreign");
  mkdirSync(path.join(foreign, threadId), { recursive: true });
  symlinkSync(foreign, root);
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages).toHaveLength(1);
  expect(existsSync(path.join(foreign, threadId))).toBe(true);
  expect(store.worktrees()).toHaveLength(1);
});

it("uses the legacy default root for old ledger entries", async () => {
  const created = await worktrees.create(cwd, owner(18), "legacy", "HEAD");
  store.forgetWorktree(created.path);
  store.addWorktree({ ...created, root: null });
  await worktrees.remove(worktrees.forThread(created.threadId)!, false);
  expect(store.worktrees()).toEqual([]);
});

it("never adopts an existing folder in the selected directory", async () => {
  const root = path.join(dir, "custom");
  const folder = path.join(root, owner(19));
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "valuable"), "keep");
  await expect(worktrees.create(cwd, owner(19), "collision", "HEAD", root)).rejects.toThrow(
    "already exists",
  );
  expect(store.worktrees()).toEqual([]);
  expect(readFileSync(path.join(folder, "valuable"), "utf8")).toBe("keep");
  expect((await git.status(cwd)).branches).not.toContain("collision");
});

it("refuses non-directory custom roots without reserving ownership", async () => {
  const file = path.join(dir, "file");
  writeFileSync(file, "keep");
  await expect(worktrees.create(cwd, owner(20), "file", "HEAD", file)).rejects.toThrow();
  await expect(worktrees.create(cwd, owner(20), "relative", "HEAD", "relative")).rejects.toThrow(
    "absolute path",
  );
  expect(store.worktrees()).toEqual([]);
});

it("rejects symlink replacements in custom directories", async () => {
  const created = await worktrees.create(
    cwd,
    owner(21),
    "custom-safe",
    "HEAD",
    path.join(dir, "custom"),
  );
  await git.run(cwd, ["worktree", "remove", created.path]);
  symlinkSync(cwd, created.path);
  await expect(worktrees.remove(created, true)).rejects.toThrow("managed linked worktree");
  expect(existsSync(path.join(cwd, "a"))).toBe(true);
});

it("requires explicit force for dirty and ignored files", async () => {
  const worktree = await worktrees.create(cwd, owner(2), "dirty", "HEAD");
  writeFileSync(path.join(worktree.path, "ignored"), "valuable");
  await expect(worktrees.remove(worktree, false)).rejects.toThrow("ignored files");
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages).toHaveLength(1);
  expect(existsSync(worktree.path)).toBe(true);
  rmSync(path.join(worktree.path, "ignored"));
  writeFileSync(path.join(worktree.path, "a"), "dirty");
  await expect(worktrees.remove(worktree, false)).rejects.toThrow();
  await worktrees.remove(worktree, true);
  expect(existsSync(worktree.path)).toBe(false);
});

it("cleans only clean abandoned owners, including a creation that failed before making its folder", async () => {
  const owned = await worktrees.create(cwd, owner(3), "owned", "HEAD");
  const project = store.addProject(cwd, CREATED_AT);
  store.addThread({
    id: owned.threadId,
    projectId: project.id,
    sessionFile: null,
    createdAt: CREATED_AT,
  });
  const abandoned = await worktrees.create(cwd, owner(4), "abandoned", "HEAD");
  await expect(worktrees.create(cwd, owner(5), "main", "HEAD")).rejects.toThrow();
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages).toEqual([]);
  expect(existsSync(owned.path)).toBe(true);
  expect(existsSync(abandoned.path)).toBe(false);
  expect(store.worktrees()).toEqual([owned]);
});

it("preserves an abandoned checkout whose branch changed or which was added as a project", async () => {
  const worktree = await worktrees.create(cwd, owner(6), "original", "HEAD");
  await git.run(worktree.path, ["switch", "-c", "renamed"]);
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages[0]).toContain("branch changed");
  expect(existsSync(worktree.path)).toBe(true);
  store.addProject(worktree.path, CREATED_AT);
  await expect(worktrees.remove(worktree, true)).rejects.toThrow(
    "A project still uses this worktree",
  );
  expect(existsSync(worktree.path)).toBe(true);
});

it("cleans the registration of a missing abandoned folder without deleting its branch", async () => {
  const worktree = await worktrees.create(cwd, owner(7), "missing", "HEAD");
  rmSync(worktree.path, { recursive: true });
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(messages).toEqual([]);
  expect(store.worktrees()).toEqual([]);
  expect(await git.run(cwd, ["worktree", "list", "--porcelain"])).not.toContain(worktree.path);
  expect((await git.status(cwd)).branches).toContain("missing");
});

it("forgets a creation that Git refused, so no ledger row outlives it", async () => {
  await worktrees.create(cwd, owner(8), "taken", "HEAD");
  const before = store.worktrees();
  await expect(worktrees.create(cwd, owner(9), "taken", "HEAD")).rejects.toThrow();
  await expect(worktrees.create(cwd, owner(10), "taken", "HEAD")).rejects.toThrow();
  expect(store.worktrees()).toEqual(before);
});

it("forgets a live thread's worktree whose folder was deleted, keeping its branch", async () => {
  const worktree = await worktrees.create(cwd, owner(11), "gone", "HEAD");
  const project = store.addProject(cwd, CREATED_AT);
  store.addThread({
    id: worktree.threadId,
    projectId: project.id,
    sessionFile: null,
    createdAt: CREATED_AT,
  });
  expect(await worktrees.forgetIfMissing(worktree)).toBe(false);
  expect(store.worktrees()).toEqual([worktree]);
  rmSync(worktree.path, { recursive: true });
  expect(await worktrees.forgetIfMissing(worktree)).toBe(true);
  expect(store.worktrees()).toEqual([]);
  expect(await git.run(cwd, ["worktree", "list", "--porcelain"])).not.toContain(worktree.path);
  expect((await git.status(cwd)).branches).toContain("gone");
});

it("clears an abandoned empty owned folder, and explains a foreign one in plain words", async () => {
  const root = path.join(dir, "managed");
  mkdirSync(root);
  const empty = {
    root: null,
    path: path.join(root, owner(12)),
    repository: cwd,
    branch: "x",
    threadId: "",
  };
  empty.threadId = path.basename(empty.path);
  mkdirSync(empty.path);
  const full = {
    root: null,
    path: path.join(root, owner(13)),
    repository: cwd,
    branch: "y",
    threadId: "",
  };
  full.threadId = path.basename(full.path);
  mkdirSync(full.path);
  writeFileSync(path.join(full.path, "notes"), "keep");
  store.addWorktree(empty);
  store.addWorktree(full);
  const messages: string[] = [];
  await worktrees.cleanup((message) => messages.push(message));
  expect(existsSync(empty.path)).toBe(false);
  expect(store.worktrees()).toEqual([full]);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("not Tondo's managed linked worktree");
  expect(messages[0]).toContain("delete the folder");
  expect(messages[0]).not.toContain("ENOENT");
  expect(existsSync(path.join(full.path, "notes"))).toBe(true);
});

it("refuses paths outside its managed root and symlink replacements even with force", async () => {
  const worktree = await worktrees.create(cwd, owner(14), "safe", "HEAD");
  await expect(worktrees.remove({ ...worktree, path: cwd }, true)).rejects.toThrow(
    "managed linked worktree",
  );
  await git.run(cwd, ["worktree", "remove", worktree.path]);
  symlinkSync(cwd, worktree.path);
  await expect(worktrees.remove(worktree, true)).rejects.toThrow("managed linked worktree");
  expect(existsSync(path.join(cwd, "a"))).toBe(true);
});
