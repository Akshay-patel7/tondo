// Onboarding with the real pi, offline: a pi Tondo can't find or can't use, pi
// with no model you have credentials for, a project that needs trust, and the
// welcome on first launch.
import { expect, test, type ElectronApplication } from "@playwright/test";
import {
  chmodSync,
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
import { bringToFront, launchTondo, type Tondo } from "./launch";
import { addProject, launchWithPi, PI_CLI, PI_START_TIMEOUT_MS, waitForPi } from "./pi";
import { piGroup, piGroups } from "./processes";

test.describe.configure({ timeout: 60_000 });

/** The oldest pi Tondo runs (MIN_PI_VERSION in src/host/findPi.ts). */
const REQUIRED_PI = "0.87.1";

const PI_VERSION = (
  JSON.parse(readFileSync(path.resolve(PI_CLI, "../../../package.json"), "utf8")) as {
    version: string;
  }
).version;

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-onboarding-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

function readSettings({ profileDir }: Tondo): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(profileDir, "settings.json"), "utf8"));
}

/** Makes main's file dialog pick `file` from now on, without showing it. */
function answerFileDialog(app: ElectronApplication, file: string): Promise<void> {
  return app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, file);
}

/** The pi pnpm installed as a `pi` command in `bin` with node beside it, as e2e/pi.ts installs it. */
function installPi(bin: string): string {
  mkdirSync(bin);
  symlinkSync(PI_CLI, path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  return path.join(bin, "pi");
}

/** A pi install Tondo refuses: pi's package at 0.80.0, its cli.js, a `pi` command and a node. */
function oldPi(): string {
  const pkg = path.join(workDir, "old-pi", "package");
  const bin = path.join(workDir, "old-pi", "bin");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "0.80.0",
      bin: { pi: "cli.js" },
    }),
  );
  writeFileSync(path.join(pkg, "cli.js"), "#!/usr/bin/env node\n");
  chmodSync(path.join(pkg, "cli.js"), 0o755);
  symlinkSync(path.join(pkg, "cli.js"), path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  return path.join(bin, "pi");
}

test("a pi Tondo can't find says so, and the pi you choose starts", async () => {
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  await bringToFront(tondo);
  const { app, page } = tondo;
  // launchWithPi points piPath at the pi it installed. The host reads
  // settings.json each time it starts pi, so the project's pi looks for
  // /nonexistent/pi instead.
  const { piPath } = readSettings(tondo) as { piPath: string };
  writeFileSync(
    path.join(tondo.profileDir, "settings.json"),
    JSON.stringify({ piPath: "/nonexistent/pi" }),
  );
  await addProject(tondo, project);

  const heading = page.getByRole("heading", { name: "pi isn't installed" });
  await expect(heading).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await expect(heading).toBeFocused();
  const setup = page.getByRole("region", { name: "pi isn't installed" });
  await expect(setup).toContainText("/nonexistent/pi doesn't exist.");
  await expect(page.getByRole("alert").filter({ hasText: "Restart pi" })).toHaveCount(0);

  await answerFileDialog(app, piPath);
  await setup.getByRole("button", { name: "Choose pi…" }).click();
  await waitForPi(page);
  await expect(page.getByLabel("Model")).toBeEnabled();
  expect(readSettings(tondo).piPath).toBe(piPath);
});

test("a pi that's too old says which version Tondo needs", async () => {
  tondo = await launchTondo({ settings: { piPath: oldPi() } });
  const { page } = tondo;
  await addProject(tondo, project);

  const setup = page.getByRole("region", { name: "Tondo needs a newer pi" });
  await expect(setup).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  await expect(setup).toContainText(`is pi 0.80.0, and Tondo needs ${REQUIRED_PI} or newer.`);
  await expect(setup).toContainText("npm install -g @earendil-works/pi-coding-agent");

  await setup.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
});

test("pi with no model you can use offers the sign-in terminal, and reloads after it", async () => {
  tondo = await launchTondo({
    settings: { piPath: installPi(path.join(workDir, "bin")) },
    // pi without the faux extension and provider: nothing in the scratch pi setup is signed in.
    env: {
      TONDO_PI_ARGS: JSON.stringify([
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--offline",
      ]),
    },
  });
  const { app, page } = tondo;
  await addProject(tondo, project);

  const prompt = page.getByRole("region", { name: "Sign in to a provider" });
  await expect(prompt).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
  const signedOut = await piGroup(app);
  await prompt.getByRole("button", { name: "Open sign-in terminal" }).click();
  const terminal = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(terminal.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();

  // pi reads credentials as it starts, so closing the terminal starts a new pi.
  await terminal.getByRole("button", { name: "Close terminal" }).click();
  await expect(terminal).toBeHidden();
  await expect
    .poll(
      async () => {
        const groups = await piGroups(app);
        return groups.length === 1 && groups[0] !== signedOut;
      },
      { timeout: PI_START_TIMEOUT_MS },
    )
    .toBe(true);
  await expect(prompt).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
});

test("a project that needs trust asks first, and Tondo keeps the answer", async () => {
  mkdirSync(path.join(project, ".pi"));
  writeFileSync(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({ defaultThinkingLevel: "low" }),
  );
  tondo = await launchWithPi({ workDir, script: { responses: [] } });
  await bringToFront(tondo);
  const { page } = tondo;
  await addProject(tondo, project);

  const question = page.getByRole("region", { name: "Trust project folder?" });
  await expect(question).toBeVisible();
  await expect(question).toContainText(project);
  await expect(question.getByRole("button", { name: "Don't trust" })).toBeFocused();

  await question.getByRole("button", { name: "Trust", exact: true }).click();
  await waitForPi(page);
  await expect(question).not.toBeAttached();
  expect(readSettings(tondo).projectTrust).toEqual({ [project]: true });
});

test("the welcome says whether Tondo found pi, and the pi you choose fixes it", async () => {
  const pi = installPi(path.join(workDir, "bin"));
  tondo = await launchTondo({ settings: { piPath: "/nonexistent/pi" } });
  const { app, page } = tondo;

  await expect(page.getByRole("heading", { name: "Welcome to Tondo" })).toBeVisible();
  const welcome = page.getByRole("main");
  await expect(welcome).toContainText("pi isn't installed.");
  await expect(welcome.getByRole("button", { name: "Add project…" })).toBeEnabled();

  await answerFileDialog(app, pi);
  await welcome.getByRole("button", { name: "Choose pi…" }).click();
  await expect(welcome).toContainText(`Found pi ${PI_VERSION} at the path in Settings.`);
  await expect(welcome.getByRole("button", { name: "Choose pi…" })).toHaveCount(0);
  expect(readSettings(tondo).piPath).toBe(pi);
});
