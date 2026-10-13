import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedUpdatePackages, updateFixture } from "../../e2e/piUpdatesFixture";
import type { PiUpdate } from "../shared/piUpdates";
import { probePiUpdates, type PiMaintenanceContext } from "./piUpdateProbe";
import { PiUpdatesService, runPiMaintenance } from "./piUpdates";

let root: string;
let fixture: ReturnType<typeof updateFixture>;
let context: PiMaintenanceContext;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-pi-updates-")));
  fixture = updateFixture(root);
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  mkdirSync(cwd);
  seedUpdatePackages(agentDir);
  context = {
    pi: {
      cli: fixture.cli,
      command: fixture.cli,
      node: process.execPath,
      packageDir: fixture.packageDir,
      version: "0.87.1",
    },
    agentDir,
    cwd,
    projectTrusted: false,
    env: fixture.env,
    offline: false,
  };
  for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("PI_OFFLINE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function available(name: string): Promise<PiUpdate> {
  const entry = (await probePiUpdates(context)).find((item) => item.name === name);
  expect(entry?.state).toBe("available");
  return entry!;
}

function calls(): string[][] {
  return readFileSync(fixture.log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("checks installed npm versions and ranges without installing, ignores pins and local paths", async () => {
  const entries = await probePiUpdates(context);
  expect(entries.find((entry) => entry.scope === "pi")).toMatchObject({
    installed: "0.87.1",
    latest: "0.88.0",
    state: "available",
  });
  expect(entries.find((entry) => entry.name === "test-plugin")).toMatchObject({
    installed: "1.0.0",
    latest: "2.0.0",
    state: "available",
  });
  expect(entries.find((entry) => entry.name === "range-plugin")).toMatchObject({
    latest: "1.2.0",
    state: "available",
  });
  expect(entries.find((entry) => entry.name === "pinned-plugin")).toMatchObject({
    installed: "1.0.0",
    state: "pinned",
  });
  expect(entries.find((entry) => entry.source === "./local-plugin")?.state).toBe("local");
  expect(calls().every((args) => args[0] === "view")).toBe(true);
  expect(calls().some((args) => args.includes("pinned-plugin@1.0.0"))).toBe(false);
});

test("installs the reviewed version without changing source declarations or resource filters", async () => {
  const before = readFileSync(path.join(context.agentDir, "settings.json"), "utf8");
  const entry = await available("test-plugin");
  await probePiUpdates({ ...context, update: entry });
  expect(calls().find((args) => args[0] === "install")).toContain("test-plugin@2.0.0");
  expect(readFileSync(path.join(context.agentDir, "settings.json"), "utf8")).toBe(before);
  expect((await probePiUpdates(context)).find((item) => item.name === "test-plugin")).toMatchObject(
    { installed: "2.0.0", state: "current" },
  );
});

test("legacy global npm packages move to pi's managed directory without overwriting the legacy copy", async () => {
  rmSync(path.join(context.agentDir, "npm/node_modules/test-plugin"), { recursive: true });
  const legacy = path.join(root, "empty-global-modules/test-plugin");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    path.join(legacy, "package.json"),
    JSON.stringify({ name: "test-plugin", version: "1.0.0" }),
  );
  const entry = await available("test-plugin");
  await probePiUpdates({ ...context, update: entry });
  expect(JSON.parse(readFileSync(path.join(legacy, "package.json"), "utf8")).version).toBe("1.0.0");
  expect((await probePiUpdates(context)).find((item) => item.name === "test-plugin")).toMatchObject(
    { installed: "2.0.0", state: "current" },
  );
});

test("updates only the selected pi installation to the reviewed version", async () => {
  const entry = await available("@earendil-works/pi-coding-agent");
  await probePiUpdates({ ...context, update: entry });
  expect(calls().filter((args) => args[0] === "self")).toEqual([
    ["self", "@earendil-works/pi-coding-agent@0.88.0"],
  ]);
  expect(
    JSON.parse(readFileSync(path.join(fixture.packageDir, "package.json"), "utf8")).version,
  ).toBe("0.88.0");
});

test("does not read or update project packages without trust", async () => {
  const pi = path.join(context.cwd, ".pi");
  const installed = path.join(pi, "npm/node_modules/project-plugin");
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    path.join(pi, "settings.json"),
    JSON.stringify({ packages: ["npm:project-plugin"] }),
  );
  writeFileSync(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "project-plugin", version: "1.0.0" }),
  );
  expect((await probePiUpdates(context)).some((entry) => entry.scope === "project")).toBe(false);
  const trusted = { ...context, projectTrusted: true };
  const entry = (await probePiUpdates(trusted)).find((item) => item.name === "project-plugin")!;
  expect(entry).toMatchObject({ scope: "project", latest: "3.0.0", state: "available" });
  await probePiUpdates({ ...trusted, update: entry });
  expect(JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8")).version).toBe(
    "3.0.0",
  );
  await expect(probePiUpdates({ ...context, update: entry })).rejects.toThrow(
    "configuration changed",
  );
});

test("network errors are unavailable, not up to date, and recover on the next check", async () => {
  writeFileSync(path.join(root, "fail-registry"), "");
  expect(
    (await probePiUpdates(context)).find((entry) => entry.name === "test-plugin"),
  ).toMatchObject({
    state: "unavailable",
    latest: null,
    message: expect.stringContaining("Registry unavailable"),
  });
  rmSync(path.join(root, "fail-registry"));
  await available("test-plugin");
});

test("refuses an install whose reviewed version has changed meanwhile", async () => {
  const entry = await available("test-plugin");
  writeFileSync(
    path.join(context.agentDir, "npm/node_modules/test-plugin/package.json"),
    JSON.stringify({ name: "test-plugin", version: "1.1.0" }),
  );
  await expect(probePiUpdates({ ...context, update: entry })).rejects.toThrow(
    "installed package changed",
  );
  expect(calls().some((args) => args[0] === "install")).toBe(false);
});

test("Git checks and installs stay local, use the reviewed commit, and refuse local edits", async () => {
  const source = "git:git@github.example.com:team/plugin.git";
  const remote = path.join(root, "remote.git");
  const author = path.join(root, "author");
  mkdirSync(author);
  git(author, "init", "-b", "main");
  git(author, "config", "user.name", "Test");
  git(author, "config", "user.email", "test@localhost");
  git(author, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(author, "file.txt"), "before\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "baseline");
  git(root, "clone", "--bare", author, remote);
  const checkout = path.join(context.agentDir, "git/github.example.com/team/plugin");
  mkdirSync(path.dirname(checkout), { recursive: true });
  git(root, "clone", remote, checkout);
  git(checkout, "remote", "set-url", "origin", "git@github.example.com:team/plugin.git");
  git(checkout, "config", `url.${remote}.insteadOf`, "git@github.example.com:team/plugin.git");
  writeFileSync(path.join(author, "file.txt"), "after\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "update");
  git(author, "push", remote, "main");
  writeFileSync(
    path.join(context.agentDir, "settings.json"),
    JSON.stringify({ packages: [source] }),
  );
  const entry = await available(source);
  expect(entry.latest).toBe(git(author, "rev-parse", "HEAD"));
  writeFileSync(path.join(checkout, "local.txt"), "keep\n");
  await expect(probePiUpdates({ ...context, update: entry })).rejects.toThrow(
    "local files or edits",
  );
  expect(readFileSync(path.join(checkout, "local.txt"), "utf8")).toBe("keep\n");
  rmSync(path.join(checkout, "local.txt"));
  await probePiUpdates({ ...context, update: entry });
  expect(git(checkout, "rev-parse", "HEAD")).toBe(entry.latest);
  expect(readFileSync(path.join(checkout, "file.txt"), "utf8")).toBe("after\n");
});

test("maintenance strips ambient routing, reports its group and never starts an agent session", async () => {
  const worker = path.join(root, "worker.cjs");
  writeFileSync(
    worker,
    `const input=JSON.parse(process.argv[2]);console.log('TONDO_PI_UPDATE_RESULT:'+JSON.stringify([{message:JSON.stringify({input,env:process.env,args:process.argv.slice(2)})}]));`,
  );
  const groups: number[][] = [];
  const entries = await runPiMaintenance(
    {
      ...context,
      env: {
        ...context.env,
        PI_OFFLINE: "1",
        PI_PACKAGE_DIR: "/wrong",
        GIT_DIR: "/wrong",
        GIT_INDEX_FILE: "/wrong",
      },
    },
    (value) => groups.push(value),
    undefined,
    worker,
  );
  const { input, env, args } = JSON.parse(entries[0]!.message!);
  expect(input).toMatchObject({
    cwd: context.cwd,
    agentDir: context.agentDir,
    projectTrusted: false,
  });
  expect(args).toHaveLength(1);
  expect(env.PI_CODING_AGENT_DIR).toBe(context.agentDir);
  for (const key of ["PI_OFFLINE", "PI_PACKAGE_DIR", "GIT_DIR", "GIT_INDEX_FILE"])
    expect(env).not.toHaveProperty(key);
  expect(groups[0]).toHaveLength(1);
  expect(groups.at(-1)).toEqual([]);
});

test("maintenance output is bounded and its descendant process is reaped", async () => {
  const pidFile = path.join(root, "helper.pid");
  const helper = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.send('ready');setInterval(()=>{},1000);`;
  const worker = path.join(root, "worker.cjs");
  writeFileSync(
    worker,
    `const {spawn}=require('child_process');const helper=spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:['ignore','inherit','inherit','ipc']});helper.on('message',()=>process.stdout.write(Buffer.alloc(5*1024*1024,65)));`,
  );
  const groups: number[][] = [];
  await expect(
    runPiMaintenance(context, (value) => groups.push(value), undefined, worker),
  ).rejects.toThrow("output exceeded 4 MiB");
  const pid = Number(readFileSync(pidFile, "utf8"));
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    })
    .toBe(false);
  expect(groups.at(-1)).toEqual([]);
});

test("offered ids cannot be invented or reused after a fresh check, and busy guards prevent all writes", async () => {
  const runner = vi
    .fn()
    .mockImplementation((value, _groups, update) =>
      update ? Promise.resolve([]) : probePiUpdates(value),
    );
  const service = new PiUpdatesService(vi.fn(), vi.fn(), runner);
  await service.check({ ...context, offline: true }, false);
  expect(runner).not.toHaveBeenCalled();
  await service.check(context, true);
  const old = service.state.entries.find((entry) => entry.name === "test-plugin")!;
  await service.check(context, true);
  const stopIdle = vi.fn().mockResolvedValue(undefined);
  await expect(service.apply(old.id, context, stopIdle)).rejects.toThrow("no longer offered");
  expect(stopIdle).not.toHaveBeenCalled();
  const entry = service.state.entries.find((item) => item.name === "test-plugin")!;
  await expect(service.apply(entry.id, { ...context, agentDir: root }, stopIdle)).rejects.toThrow(
    "changed",
  );
  const busy = vi.fn().mockRejectedValue(new Error("A thread is busy"));
  await expect(service.apply(entry.id, context, busy)).rejects.toThrow("busy");
  expect(service.state.error).toBe("A thread is busy");
  expect(service.state.applying).toBeNull();
  expect(runner.mock.calls.every((args) => args[2] === undefined)).toBe(true);
  await service.apply(entry.id, context, stopIdle);
  expect(stopIdle).toHaveBeenCalledTimes(1);
});
