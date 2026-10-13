import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  launchWithPi,
  reply,
  send,
  waitForFileCommand,
  waitForIdle,
  waitForPi,
} from "./pi";
import { seedUpdatePackages, updateFixture } from "./piUpdatesFixture";

let root: string;
let tondo: Tondo | undefined;
test.beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-updates-e2e-")));
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function start(responses = [reply("Ready.")], withProjectPackage = false) {
  const fixture = updateFixture(root);
  const profileDir = path.join(root, "profile");
  const project = path.join(root, "project");
  mkdirSync(profileDir);
  mkdirSync(project);
  const agent = process.env.TONDO_E2E_EXECUTABLE
    ? path.join(root, "pi-agent")
    : path.join(profileDir, "pi-agent");
  seedUpdatePackages(agent);
  if (withProjectPackage) {
    const installed = path.join(project, ".pi/npm/node_modules/test-plugin");
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      path.join(installed, "package.json"),
      JSON.stringify({ name: "test-plugin", version: "0.5.0" }),
    );
    writeFileSync(
      path.join(project, ".pi/settings.json"),
      JSON.stringify({
        packages: [{ source: "npm:test-plugin", extensions: [], skills: ["SKILL.md"], themes: [] }],
      }),
    );
  }
  tondo = await launchWithPi({
    workDir: root,
    profileDir,
    cli: fixture.cli,
    env: fixture.env,
    settings: { projectTrust: withProjectPackage ? { [project]: true } : {} },
    script: { responses },
  });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await tondo.page.getByRole("button", { name: "Settings", exact: true }).click();
  await tondo.page.getByRole("button", { name: "pi", exact: true }).click();
  return { ...fixture, agent, project, page: tondo.page };
}

function calls(log: string): string[][] {
  try {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("review and update pi and packages without changing pins or package filters", async () => {
  const { page, log, packageDir, agent } = await start();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const before = readFileSync(path.join(agent, "settings.json"), "utf8");
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update pi", exact: true })).toBeEnabled();
  const plugin = page.getByLabel("test-plugin", { exact: true });
  await expect(plugin).toContainText("1.0.0 → 2.0.0");
  await expect(page.getByLabel("range-plugin", { exact: true })).toContainText("1.0.0 → 1.2.0");
  await expect(page.getByLabel("pinned-plugin", { exact: true })).toContainText("Pinned version");
  await expect(page.getByLabel("./local-plugin", { exact: true })).toContainText("Local package");
  expect(calls(log).some((args) => ["install", "self"].includes(args[0]!))).toBe(false);
  await page
    .getByRole("button", { name: "Update global package test-plugin", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("npm:test-plugin");
  await page.screenshot({
    path: test.info().outputPath("update-review.png"),
    animations: "disabled",
  });
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  expect(calls(log).some((args) => args[0] === "install")).toBe(false);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("updates-dark.png"),
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: light)").matches))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("updates-light.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review 3 available updates", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review 3 available updates", exact: true }).click();
  await page
    .getByRole("button", { name: "Update global package test-plugin", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect(plugin).toContainText("2.0.0 → 2.0.0");
  expect(calls(log).filter((args) => args[0] === "install")).toHaveLength(1);
  expect(calls(log).find((args) => args[0] === "install")).toContain("test-plugin@2.0.0");
  expect(readFileSync(path.join(agent, "settings.json"), "utf8")).toBe(before);
  await page.getByRole("button", { name: "Update pi", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Settings", exact: true })
      .getByText("pi 0.88.0", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Update pi", exact: true })).toHaveCount(0);
  expect(JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).version).toBe(
    "0.88.0",
  );
  expect(calls(log).filter((args) => args[0] === "self")).toEqual([
    ["self", "@earendil-works/pi-coding-agent@0.88.0"],
  ]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitForPi(page);
  await expect(
    page.getByRole("button", { name: "Review 1 available update", exact: true }),
  ).toBeVisible();
  await page.reload();
  await waitForPi(page);
  await expect(
    page.getByRole("button", { name: "Review 1 available update", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("project updates are distinct from global ones and resume the visible session and draft", async () => {
  const { page, agent, project, log } = await start([reply("History survived.")], true);
  const declaration = readFileSync(path.join(project, ".pi/settings.json"), "utf8");
  const globalManifest = readFileSync(
    path.join(agent, "npm/node_modules/test-plugin/package.json"),
    "utf8",
  );
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Update project package test-plugin", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Update global package test-plugin", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await send(page, "Remember before update.");
  await expect(page.getByText("History survived.", { exact: true })).toBeVisible();
  await waitForIdle(page);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Draft stays here.");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review 4 available updates", exact: true }).click();
  await page
    .getByRole("button", { name: "Update project package test-plugin", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Close all integrated terminals");
  expect(calls(log).some((args) => args[0] === "install")).toBe(false);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Close terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Review 4 available updates", exact: true }).click();
  await page
    .getByRole("button", { name: "Update project package test-plugin", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("project package test-plugin");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Update project package test-plugin", exact: true }),
  ).toHaveCount(0);
  expect(readFileSync(path.join(project, ".pi/settings.json"), "utf8")).toBe(declaration);
  expect(readFileSync(path.join(agent, "npm/node_modules/test-plugin/package.json"), "utf8")).toBe(
    globalManifest,
  );
  const install = calls(log).filter((args) => args[0] === "install");
  expect(install).toHaveLength(1);
  expect(install[0]).toContain(path.join(project, ".pi/npm"));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitForPi(page);
  await expect(page.getByText("History survived.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveText(
    "Draft stays here.",
  );
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await send(page, "Continue after update.");
  await expect(page.getByText("History survived.", { exact: true })).toHaveCount(2);
});

test("installation keeps drafts editable but blocks sending and reports progress outside Settings", async () => {
  const { page } = await start();
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Update global package test-plugin", exact: true }),
  ).toBeEnabled();
  writeFileSync(path.join(root, "block-install"), "");
  await page
    .getByRole("button", { name: "Update global package test-plugin", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect
    .poll(() => {
      try {
        readFileSync(path.join(root, "install-started"));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review update in progress", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Message", exact: true });
  await editor.fill("Must remain unsent.");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Model", { exact: true })).toBeDisabled();
  await editor.press("Enter");
  await expect(editor).toHaveText("Must remain unsent.");
  await page.screenshot({ path: test.info().outputPath("update-in-progress.png") });
  writeFileSync(path.join(root, "release-install"), "");
  await expect(
    page.getByRole("button", { name: "Review update in progress", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(editor).toHaveText("Must remain unsent.");
  await editor.press("Enter");
  await expect(page.getByText("Ready.", { exact: true })).toBeVisible();
});

test("failed checks are not reported as current and an active turn blocks installation", async () => {
  const release = path.join(root, "release");
  const marker = path.join(root, "working");
  const { page, log } = await start([
    bashCall(`touch '${marker}'; ${waitForFileCommand(release)}`),
    reply("Finished."),
  ]);
  writeFileSync(path.join(root, "fail-registry"), "");
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByLabel("test-plugin", { exact: true })).toContainText(
    "Registry unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Update global package test-plugin", exact: true }),
  ).toHaveCount(0);
  rmSync(path.join(root, "fail-registry"));
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Update global package test-plugin", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await send(page, "Start work.");
  await expect
    .poll(() => {
      try {
        readFileSync(marker);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page.getByRole("button", { name: "Review 3 available updates", exact: true }).click();
  await page
    .getByRole("button", { name: "Update global package test-plugin", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Install update", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Wait for every pi turn");
  expect(calls(log).some((args) => ["install", "self"].includes(args[0]!))).toBe(false);
  writeFileSync(release, "");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("Finished.", { exact: true })).toBeVisible();
});
