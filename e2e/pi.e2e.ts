// The host runs the real pi, offline with pi-ai's faux provider. Whether the
// host dies mid-turn or the app quits, nothing pi started outlives it. A pi
// that fails shows why.
import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hostPid, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  composer,
  launchWithPi,
  PI_START_TIMEOUT_MS,
  send,
  waitForPi,
} from "./pi";
import { allProcesses, piGroup, processesIn, reportProcesses } from "./processes";

test.describe.configure({ timeout: 60_000 });

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
  tondo = await launchWithPi({ workDir, script: { responses: [runTool()] } });
  const { groups, piLeader, toolPid } = await startTurn(tondo);
  const before = processesIn(groups);
  expect(before.map(({ pid }) => pid)).toEqual(expect.arrayContaining([piLeader, toolPid]));

  process.kill(await hostPid(tondo.app), "SIGKILL");
  await expect.poll(() => processesIn(groups), { timeout: 20_000 }).toEqual([]);
  reportProcesses("processes.txt", { before, after: processesIn(groups) });
  await expect.poll(() => readLog("main.log")).toContain("Tondo Host exited with code");
});

test("quitting stops pi and everything it started", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [runTool()] } });
  const { groups, piLeader } = await startTurn(tondo);

  await tondo.close();
  // Tondo waited for pi's group to empty before it quit.
  expect(processesIn([piLeader])).toEqual([]);
  // pi stopped its bash command's group as it exited, and that may take a moment to finish.
  await expect.poll(() => processesIn(groups)).toEqual([]);
});

test("a pi that fails to start shows why, and offers a restart", async () => {
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
  tondo = await launchWithPi({
    workDir,
    script: { responses: [] },
    cli: path.join(broken, "cli.js"),
  });
  const { page } = tondo;
  await addProject(tondo, project);

  const banner = page.getByRole("alert");
  await expect(banner).toContainText("pi exited with code 3.", { timeout: PI_START_TIMEOUT_MS });
  await banner.getByText("Details").click();
  await expect(banner).toContainText("pi fails on purpose");
  await expect(banner.getByRole("button", { name: "Restart pi" })).toBeVisible();
  await expect(composer(page)).toHaveAttribute("aria-placeholder", "pi isn't running");
  expect(readLog("host.log")).toContain("pi fails on purpose");
});

/**
 * A reply that runs a bash command, which starts a sleep and then writes its
 * shell's pid to tool.pid. Sleep starts first because on macOS a SIGKILL sent
 * to the group while bash forks can miss the new child.
 */
function runTool() {
  return bashCall(`sleep 600 & echo $$ > '${path.join(workDir, "tool.pid")}'; wait`);
}

/**
 * Opens the project, sends a prompt, and resolves once pi's bash command is
 * running, with pi's pid and every group to watch: pi's and the command's.
 */
async function startTurn(started: Tondo) {
  await addProject(started, project);
  await waitForPi(started.page);
  await send(started.page, "Run the tool.");

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
  const piLeader = await piGroup(started.app);
  const tool = allProcesses().find(({ pid }) => pid === toolPid);
  if (tool === undefined) throw new Error(`pi's bash command (${toolPid}) isn't running`);
  return { piLeader, toolPid, groups: [...new Set([piLeader, tool.pgid])] };
}

function readLog(name: string): string {
  try {
    return readFileSync(path.join(tondo!.profileDir, "logs", name), "utf8");
  } catch {
    return "";
  }
}
