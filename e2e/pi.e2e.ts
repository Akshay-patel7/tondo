// The host runs the real pi, offline with pi-ai's faux provider. Whether the
// host dies mid-turn or the app quits, nothing pi started outlives it.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { hostPid, launchTondo, type Tondo } from "./launch";

const repoRoot = path.resolve(__dirname, "..");
const piCli = path.join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
);
const piArgs = [
  "--no-extensions",
  "-e",
  path.join(repoRoot, "scripts/fixtures/faux-ext.ts"),
  "--no-skills",
  "--no-context-files",
  "--offline",
  "--provider",
  "faux",
  "--model",
  "faux-1",
  "--no-session",
];

/** What main exposes to tests in an unpackaged build, in src/main/index.ts. */
interface TondoTest {
  runPi(cwd: string, prompt: string): void;
  processGroups(): number[];
}

interface Process {
  pid: number;
  pgid: number;
  /** The process as ps listed it: pid, pgid, ppid, state and command. */
  line: string;
}

// Starting pi runs your login shell first, which can take seconds on CI.
test.describe.configure({ timeout: 60_000 });
const PI_START_TIMEOUT_MS = 30_000;

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-pi-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

test("nothing pi started survives a host killed mid-turn", async () => {
  const { app } = (tondo = await launch(installPi(piCli, "bin")));
  const { piGroup, toolPid, groups } = await startTurn(app);
  const before = processesIn(groups);
  expect(before.map(({ pid }) => pid)).toEqual(expect.arrayContaining([piGroup, toolPid]));

  process.kill(await hostPid(app), "SIGKILL");
  await expect.poll(() => processesIn(groups), { timeout: 20_000 }).toEqual([]);
  report("processes.txt", { before, after: processesIn(groups) });
  await expect.poll(() => readLog("main.log")).toContain("Tondo Host exited with code");
});

test("quitting stops pi and everything it started", async () => {
  const { app } = (tondo = await launch(installPi(piCli, "bin")));
  const { piGroup, groups } = await startTurn(app);

  await tondo.close();
  // Tondo waited for pi's group to empty before it quit.
  expect(processesIn([piGroup])).toEqual([]);
  // pi stopped its bash command's group as it exited, and that may take a moment to finish.
  await expect.poll(() => processesIn(groups)).toEqual([]);
});

test("the host's log reports a pi that fails, with the end of its stderr", async () => {
  // A pi install whose cli.js fails straight away.
  const broken = path.join(workDir, "broken");
  mkdirSync(broken);
  writeFileSync(
    path.join(broken, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "0.87.1",
      bin: { pi: "cli.js" },
    }),
  );
  writeFileSync(
    path.join(broken, "cli.js"),
    'console.error("pi fails on purpose");\nprocess.exit(3);\n',
  );
  const { app } = (tondo = await launch(installPi(path.join(broken, "cli.js"), "broken-bin")));

  await runPi(app);
  await expect
    .poll(() => readLog("host.log"), { timeout: PI_START_TIMEOUT_MS })
    .toContain("pi exited with code 3.");
  expect(readLog("host.log")).toContain("pi fails on purpose");
});

/** Installs `cli` the way Tondo finds pi: a `pi` command in `workDir/<dir>` with a node beside it. */
function installPi(cli: string, dir: string): string {
  const bin = path.join(workDir, dir);
  mkdirSync(bin);
  symlinkSync(cli, path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  return path.join(bin, "pi");
}

/**
 * Launches Tondo with `piPath` as its pi. The faux model answers the first
 * prompt with a bash command that starts a sleep, then writes its shell's pid
 * to tool.pid. Sleep starts first because on macOS a SIGKILL sent to the group
 * while bash forks can miss the new child.
 */
function launch(piPath: string): Promise<Tondo> {
  const script: FauxScript = {
    responses: [bashCall(`sleep 600 & echo $$ > '${path.join(workDir, "tool.pid")}'; wait`)],
  };
  const scriptPath = path.join(workDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  return launchTondo({
    settings: { piPath },
    env: { TONDO_PI_ARGS: JSON.stringify(piArgs), TONDO_FAUX_SCRIPT: scriptPath },
  });
}

/**
 * A model reply that runs `command` with pi's bash tool, as pi-ai's
 * fauxToolCall builds it. Playwright can't load pi-ai at run time, since pi-ai
 * exports nothing to `require`, so this builds the message itself.
 */
function bashCall(command: string): AssistantMessage {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call_bash", name: "bash", arguments: { command } }],
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: { ...zero, totalTokens: 0, cost: { ...zero, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function runPi(app: ElectronApplication): Promise<void> {
  return app.evaluate((_electron, cwd) => {
    (globalThis as unknown as { tondoTest: TondoTest }).tondoTest.runPi(cwd, "Run the tool.");
  }, project);
}

/**
 * Has the host start pi and resolves once pi's bash command is running, with
 * pi's process group and every group to watch: pi's and the command's.
 */
async function startTurn(app: ElectronApplication) {
  await runPi(app);
  const pidFile = path.join(workDir, "tool.pid");
  const readToolPid = () => {
    try {
      return Number(readFileSync(pidFile, "utf8"));
    } catch {
      return 0;
    }
  };
  await expect.poll(readToolPid, { timeout: PI_START_TIMEOUT_MS }).toBeGreaterThan(0);
  const toolPid = readToolPid();

  const reported = () =>
    app.evaluate(() =>
      (globalThis as unknown as { tondoTest: TondoTest }).tondoTest.processGroups(),
    );
  await expect.poll(reported).toHaveLength(1);
  const [piGroup] = await reported();
  const tool = allProcesses().find(({ pid }) => pid === toolPid);
  if (piGroup === undefined || tool === undefined) {
    throw new Error(`pi's group (${piGroup}) or its bash command (${toolPid}) isn't running`);
  }
  return { piGroup, toolPid, groups: [...new Set([piGroup, tool.pgid])] };
}

/**
 * Every live process. One that is exiting (macOS's state E) or has exited but
 * not been reaped yet (state Z) doesn't count.
 */
function allProcesses(): Process[] {
  const output = execFileSync(
    "ps",
    ["-A", "-o", "pid=", "-o", "pgid=", "-o", "ppid=", "-o", "stat=", "-o", "command="],
    { encoding: "utf8" },
  );
  return output.split("\n").flatMap((raw) => {
    const line = raw.trim();
    const [pid, pgid, , stat] = line.split(/\s+/);
    if (!line || stat === undefined || /^[EZ]/.test(stat)) return [];
    return [{ pid: Number(pid), pgid: Number(pgid), line }];
  });
}

function processesIn(groups: readonly number[]): Process[] {
  return allProcesses().filter(({ pgid }) => groups.includes(pgid));
}

function readLog(name: string): string {
  try {
    return readFileSync(path.join(tondo!.profileDir, "logs", name), "utf8");
  } catch {
    return "";
  }
}

/** Writes process lists to the test's output folder, for the stage report. */
function report(file: string, lists: Record<string, Process[]>): void {
  const text = Object.entries(lists)
    .map(([title, list]) =>
      [`${title}: PID PGID PPID STAT COMMAND`, ...list.map(({ line }) => line)].join("\n"),
    )
    .join("\n\n");
  writeFileSync(test.info().outputPath(file), `${text}\n`);
}
