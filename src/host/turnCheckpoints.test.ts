import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkpointRef, hasCheckpoint } from "./checkpoints";
import { Store } from "./store";
import { TurnCheckpoints } from "./turnCheckpoints";

let root: string;
let store: Store;
let turns: TurnCheckpoints;
const id = "test-thread";
const changed = vi.fn();
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
}
function write(text: string): void {
  writeFileSync(path.join(root, "file.txt"), text);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "tondo-turn-checkpoints-"));
  store = Store.open(":memory:");
  const project = store.addProject(root, 1);
  store.addThread({ id, projectId: project.id, createdAt: 1, sessionFile: null });
  changed.mockClear();
  turns = new TurnCheckpoints(store, id, root, changed);
});
afterEach(async () => {
  await turns.drain();
  store.close();
  rmSync(root, { recursive: true, force: true });
});

test("captures before a prompt and after settled; retries and queued prompts share a turn", async () => {
  git("init", "-q");
  write("before\n");
  await turns.prepare();
  expect(turns.turns).toEqual([]);
  expect(await hasCheckpoint(root, id, 0)).toBe(true);
  turns.started();
  write("after\n");
  await turns.prepare();
  turns.started();
  expect(turns.turns).toHaveLength(1);
  turns.settled();
  expect(turns.busy).toBe(true);
  await turns.drain();
  expect(turns.busy).toBe(false);
  expect(turns.turns[0]).toMatchObject({ turn: 1, state: "ready", reason: null });
  const diff = await turns.diff(1);
  expect(diff.error).toBeNull();
  expect(diff.files[0]?.patch).toContain("-before\n+after");
  expect(changed).toHaveBeenCalled();
});

test("waits for completion before preparing the next prompt and reuses its baseline", async () => {
  git("init", "-q");
  write("initial\n");
  await turns.prepare();
  turns.started();
  write("first\n");
  turns.settled();
  await turns.prepare();
  const completed = git("rev-parse", checkpointRef(id, 1));
  turns.started();
  write("second\n");
  turns.settled();
  await turns.drain();
  expect(git("rev-parse", checkpointRef(id, 1))).toBe(completed);
  expect((await turns.diff(2)).files[0]?.patch).toContain("-first\n+second");
  expect(turns.turns.map((turn) => turn.state)).toEqual(["ready", "ready"]);
});

test("keeps completion when Git is initialized during a turn, without inventing a baseline", async () => {
  await turns.prepare();
  turns.started();
  git("init", "-q");
  write("first\n");
  turns.settled();
  await turns.drain();
  expect(await hasCheckpoint(root, id, 0)).toBe(false);
  expect(await hasCheckpoint(root, id, 1)).toBe(true);
  expect(turns.turns[0]?.state).toBe("unavailable");
  expect((await turns.diff(1)).error).toContain("baseline");
  await turns.prepare();
  turns.started();
  write("next\n");
  turns.settled();
  await turns.drain();
  expect((await turns.diff(2)).files[0]?.patch).toContain("-first\n+next");
});

test("explains non-Git folders and a failed baseline, never presenting them as empty diffs", async () => {
  await turns.prepare();
  turns.started();
  turns.settled();
  await turns.drain();
  expect((await turns.diff(1)).error).toContain("not a Git checkout");
  git("init", "-q");
  write("contents\n");
  // An invalid identity configuration must not affect commit-tree; this failure is a broken index.
  writeFileSync(path.join(root, ".git/index"), "not an index");
  await turns.prepare();
  turns.started();
  turns.settled();
  await turns.drain();
  expect((await turns.diff(2)).error).toContain("checkpoint failed");
});

test("extension-started work without a prepared baseline is marked unavailable", async () => {
  git("init", "-q");
  write("already changed\n");
  turns.started();
  turns.settled();
  await turns.drain();
  expect(await hasCheckpoint(root, id, 0)).toBe(false);
  expect(await hasCheckpoint(root, id, 1)).toBe(true);
  expect((await turns.diff(1)).error).toContain("No baseline");
});

test("extension work overlapping a pending completion invalidates that diff", async () => {
  git("init", "-q");
  write("initial\n");
  await turns.prepare();
  turns.started();
  write("one\n");
  turns.settled();
  turns.started();
  write("two\n");
  turns.settled();
  await turns.drain();
  expect((await turns.diff(1)).error).toContain("another run");
  expect((await turns.diff(2)).error).toContain("No baseline");
});

test("completed turns survive a reopen; unfinished turns stay unavailable and numbering advances", async () => {
  git("init", "-q");
  write("initial\n");
  await turns.prepare();
  turns.started();
  write("first\n");
  turns.settled();
  await turns.drain();
  await turns.prepare();
  turns.started();
  turns = new TurnCheckpoints(store, id, root, changed);
  expect(turns.turns.map((turn) => turn.state)).toEqual(["ready", "unavailable"]);
  expect((await turns.diff(1)).files[0]?.patch).toContain("+first");
  expect((await turns.diff(2)).error).toContain("Tondo stopped");
  await turns.prepare();
  turns.started();
  write("third\n");
  turns.settled();
  await turns.drain();
  expect(turns.turns.at(-1)).toMatchObject({ turn: 3, state: "ready" });
  expect(readFileSync(path.join(root, "file.txt"), "utf8")).toBe("third\n");
});

test("a removed ref reports an error rather than silently comparing against HEAD", async () => {
  git("init", "-q");
  write("initial\n");
  await turns.prepare();
  turns.started();
  write("first\n");
  turns.settled();
  await turns.drain();
  git("update-ref", "-d", checkpointRef(id, 0));
  expect((await turns.diff(1)).error).not.toBeNull();
  expect((await turns.diff(999)).error).toContain("no such checkpoint");
});
