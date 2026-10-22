import { expect, test } from "@playwright/test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  composer,
  launchWithPi,
  send,
  threads,
  waitForIdle,
  waitForPi,
  reply,
} from "./pi";
import { piGroups } from "./processes";
import { sessionFolder, writeSessions } from "./sessions";

test.describe.configure({ timeout: 60_000 });

let workDir: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-sidebar-hover-")));
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

for (const theme of ["light", "dark"] as const) {
  test(`thread hover shows the full title and its own model in ${theme}`, async () => {
    tondo = await launchWithPi({ workDir, script: { responses: [] }, settings: { theme } });
    await bringToFront(tondo);
    const { page, app, profileDir } = tondo;
    await page.emulateMedia({ colorScheme: null });
    await expect
      .poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
      .toBe(theme === "dark");
    const project = path.join(workDir, "project");
    mkdirSync(project);
    const [saved, unknown] = writeSessions(sessionFolder(profileDir, project), project, 2);
    const title =
      "Investigate sidebar thread hover cards and preserve the selected model across sessions. "
        .repeat(3)
        .trim();
    appendFileSync(
      saved!.file,
      `${JSON.stringify({
        type: "model_change",
        id: "hover-model",
        parentId: "00000001",
        provider: "faux",
        modelId: "faux-2",
      })}\n${JSON.stringify({
        type: "session_info",
        id: "hover-name",
        parentId: "hover-model",
        name: title,
      })}\n`,
    );
    writeFileSync(
      unknown!.file,
      readFileSync(unknown!.file, "utf8").replace('"provider":"faux","model":"faux-1",', ""),
    );
    await addProject(tondo, project);
    await waitForPi(page);
    const groups = await piGroups(app);
    const row = threads(page).getByRole("button", { name: title, exact: true });
    await expect(row).not.toHaveAttribute("title");
    const tooltip = page.locator('[data-slot="tooltip-popup"]');
    await page.getByRole("heading", { level: 1 }).hover();
    await row.hover();
    await expect(tooltip).toContainText(title);
    await expect(tooltip).toContainText("Faux 2");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
    expect((await piGroups(app)).every((group) => groups.includes(group))).toBe(true);
    const bounds = await tooltip.boundingBox();
    const rowBounds = await row.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(rowBounds!.x + rowBounds!.width);
    expect(
      await tooltip
        .locator("p")
        .evaluate(
          (element) =>
            element.scrollHeight === element.clientHeight &&
            element.scrollWidth === element.clientWidth,
        ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`thread-hover-${theme}.png`),
      animations: "disabled",
    });

    await page.getByRole("heading", { level: 1 }).hover();
    await expect(tooltip).not.toBeAttached();
    await row.focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await expect(tooltip).toContainText(title);
    await page.keyboard.press("Escape");
    await expect(tooltip).not.toBeAttached();
    await row.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Thread actions" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Thread title" })).toHaveValue(title);
    await expect(tooltip).not.toBeAttached();
    await page.keyboard.press("Escape");
    await composer(page).focus();
    await threads(page).getByRole("button", { name: "Question 1", exact: true }).hover();
    await expect(tooltip).toContainText("Model unknown");
    expect((await piGroups(app)).every((group) => groups.includes(group))).toBe(true);
  });
}

test("model changes reach the hover card and survive pooling, reload and restart", async () => {
  const profileDir = path.join(workDir, "profile");
  const project = path.join(workDir, "project");
  mkdirSync(profileDir);
  mkdirSync(project);
  tondo = await launchWithPi({
    workDir,
    profileDir,
    script: { responses: [reply("Done.")] },
    env: { TONDO_POOL: JSON.stringify({ idleMs: 0 }) },
  });
  await bringToFront(tondo);
  let { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Remember this model");
  await expect(page.locator('[data-index="1"]')).toHaveText("Done.");
  await waitForIdle(page);
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "Faux 2", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toContainText("Faux 2");
  const row = () => threads(page).getByRole("button", { name: "Remember this model", exact: true });
  const tooltip = () => page.locator('[data-slot="tooltip-popup"]');
  await row().hover();
  await expect(tooltip()).toContainText("Faux 2");
  const first = await piGroups(tondo.app);
  await composer(page).press("ControlOrMeta+n");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New thread");
  await waitForPi(page);
  await expect
    .poll(async () => (await piGroups(tondo!.app)).some((group) => first.includes(group)))
    .toBe(false);
  await row().hover();
  await expect(tooltip()).toContainText("Faux 2");
  await page.reload();
  await waitForPi(page);
  await row().hover();
  await expect(tooltip()).toContainText("Faux 2");
  await tondo.close();
  tondo = await launchTondo({ profileDir });
  await bringToFront(tondo);
  page = tondo.page;
  await waitForPi(page);
  await row().hover();
  await expect(tooltip()).toContainText("Faux 2");
  const groups = await piGroups(tondo.app);
  await page.getByRole("heading", { level: 1 }).hover();
  await expect(tooltip()).not.toBeAttached();
  expect(await piGroups(tondo.app)).toEqual(groups);
});
