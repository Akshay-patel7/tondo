// Projects and their threads with the real pi, offline with the faux model:
// the sidebar over pi's session files, resuming a session, the process pool,
// what Tondo's store keeps, and the command palette and shortcuts.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { bringToFront, hostPid, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  composer,
  expectDraft,
  launchWithPi,
  pickFiles,
  recordStatuses,
  reply,
  send,
  THREAD_ROW,
  threadRows,
  threads,
  waitForIdle,
  waitForPi,
} from "./pi";
import { piGroup, piGroups, processesIn } from "./processes";
import { seedSession, sessionFolder, writeSessions } from "./sessions";
import { LAST_TRANSCRIPT_ROW, waitForTranscript } from "./timeline";
import { IMAGE_FIXTURE } from "../src/shared/imageFixture";

test.describe.configure({ timeout: 60_000 });

let workDir: string;
let project: string;
let tondo: Tondo | undefined;
const deletionEvidence = path.resolve(".dev/improvements-20261011/qa/deletion");

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-threads-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

/** Launches Tondo in front, with the faux model answering from `script`. */
async function launch(script: FauxScript, env: Record<string, string> = {}): Promise<Tondo> {
  tondo = await launchWithPi({ workDir, script, env });
  // The page applies pi's events once a frame, and a window you can't see gets no frames.
  await bringToFront(tondo);
  return tondo;
}

/**
 * Launches Tondo, adds the project, and asks its new thread's pi `question`.
 * The faux model answers the first question of every pi with `answer`.
 */
async function startThread(question: string, answer: string): Promise<Tondo> {
  const launched = await launch({ responses: [reply(answer)] });
  await addProject(launched, project);
  await waitForPi(launched.page);
  await ask(launched.page, question, answer);
  return launched;
}

test("the sidebar lists a project's 500 pi sessions, newest first", async () => {
  const { page, profileDir } = await launch({ responses: [] });
  const sessions = writeSessions(sessionFolder(profileDir, project), project, 500);

  const listed = await timeToListed(page, "Question 0");
  await addProject(tondo!, project);
  const listedMs = await listed.evaluate(({ done }) => done);
  test.info().annotations.push({
    type: "500 sessions listed",
    description: `${Math.round(listedMs)} ms from the click on Add project to the newest in the sidebar`,
  });

  // The empty current draft is hidden. Sessions sort by last activity.
  await expect(threadRows(page)).toHaveCount(10);
  for (let shown = 10; shown < 500;) {
    const more = Math.min(500 - shown, 25);
    shown += more;
    // oxlint-disable-next-line eslint/no-await-in-loop -- each click lists the threads after the ones the click before listed.
    await showMore(page, more, shown);
  }
  await expect(threads(page).getByRole("button", { name: /^Show \d+ more$/ })).toHaveCount(0);
  expect(await threadTitles(page)).toEqual(sessions.map(({ title }) => title));
});

test("a pi session opens with its whole transcript, and pi carries on in the same file", async () => {
  const { page, profileDir } = await launch({ responses: [reply("Carrying on.")] });
  const file = seedSession(sessionFolder(profileDir, project), project);
  await addProject(tondo!, project);

  const session = threads(page).locator(`${THREAD_ROW}:not([aria-current])`);
  await expect(session).toHaveCount(1);
  const title = await session.getAttribute("title");
  await session.click();
  await waitForTranscript(page);
  await expect(heading(page)).toHaveText(title!);
  // Tondo forgets the new thread you left without writing anything.
  await expect(threadRows(page)).toHaveCount(1);

  await waitForPi(page);
  await send(page, "Carry on.");
  await expect(message(page, LAST_TRANSCRIPT_ROW + 2)).toHaveText("Carrying on.");
  await waitForIdle(page);
  // pi resumed the session file, rather than starting a new one.
  expect(readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  const saved = readFileSync(file, "utf8");
  expect(saved).toContain('"Carry on."');
  expect(saved).toContain('"Carrying on."');
});

test("an idle thread's pi stops, and opening the thread starts pi on its session again", async () => {
  // Every pi that is idle and out of sight stops right away.
  const { app, page } = await launch(
    { responses: [reply("An answer.")] },
    {
      TONDO_POOL: JSON.stringify({ idleMs: 0 }),
    },
  );
  await addProject(tondo!, project);
  await waitForPi(page);
  await ask(page, "A question.", "An answer.");
  const first = await piGroup(app);

  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");
  // The pool stopped the first thread's pi, and everything that pi started.
  await expect.poll(() => piGroups(app)).not.toContain(first);
  expect(processesIn([first])).toEqual([]);

  await threadRow(page, "A question.").click();
  await expect(message(page, 1)).toHaveText("An answer.");
  await waitForPi(page);
  expect(await piGroup(app)).not.toBe(first);
  // Tondo forgot the new thread you left empty, and stopped its pi.
  await expect(threadRows(page)).toHaveCount(1);
});

test("confirmed deletion removes only the selected JSONL and never returns through discovery or restart", async () => {
  const { app, page, profileDir } = await startThread("First.", "Done.");

  await chooseThreadAction(page, "First.", "Rename");
  const title = page.getByRole("textbox", { name: "Thread title" });
  await expect(title).toHaveValue("First.");
  await title.fill("Parser rewrite");
  await title.press("Enter");
  await expect(heading(page)).toHaveText("Parser rewrite");
  await expect(threadRow(page, "Parser rewrite")).toBeVisible();
  // pi saved the name in the session, where the pi TUI finds it too.
  const folder = sessionFolder(profileDir, project);
  await expect.poll(() => savedNames(folder)).toEqual(["Parser rewrite"]);
  const selectedFile = path.join(
    folder,
    readdirSync(folder).find((file) => file.endsWith(".jsonl"))!,
  );

  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");
  await waitForPi(page);
  await ask(page, "Second.", "Done.");
  await expect.poll(() => threadTitles(page)).toEqual(["Second.", "Parser rewrite"]);

  await chooseThreadAction(page, "Parser rewrite", "Pin");
  await expect.poll(() => threadTitles(page)).toEqual(["Parser rewrite", "Second."]);
  await expect(
    threadRow(page, "Parser rewrite").getByRole("img", { name: "Pinned" }),
  ).toBeVisible();

  const siblingFile = path.join(
    folder,
    readdirSync(folder).find(
      (file) => file.endsWith(".jsonl") && path.join(folder, file) !== selectedFile,
    )!,
  );
  const siblingBytes = readFileSync(siblingFile, "utf8");
  await chooseThreadAction(page, "Parser rewrite", "Delete…");
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Permanently delete this pi session");
  await page.screenshot({ path: path.join(deletionEvidence, "confirmation.png") });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(threadRow(page, "Parser rewrite")).toBeVisible();
  expect(existsSync(selectedFile)).toBe(true);
  await threadRow(page, "Parser rewrite").click();
  await waitForPi(page);
  await page.keyboard.press("ControlOrMeta+k");
  const deletePalette = page.getByRole("dialog", { name: "Command palette" });
  await deletePalette.getByRole("combobox", { name: "Search" }).fill("Delete thread");
  await page.keyboard.press("Enter");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete thread", exact: true }).click();
  await expect.poll(() => threadTitles(page)).toEqual(["Second."]);
  expect(existsSync(selectedFile)).toBe(false);
  expect(readFileSync(siblingFile, "utf8")).toBe(siblingBytes);
  await page.screenshot({ path: path.join(deletionEvidence, "deleted.png") });
  mkdirSync(deletionEvidence, { recursive: true });
  writeFileSync(
    path.join(deletionEvidence, "filesystem.json"),
    JSON.stringify(
      {
        selectedFile,
        selectedExists: existsSync(selectedFile),
        siblingFile,
        siblingExists: existsSync(siblingFile),
        siblingUnchanged: readFileSync(siblingFile, "utf8") === siblingBytes,
      },
      null,
      2,
    ),
  );

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search" }).fill("parser");
  await expect(palette.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const statuses = await recordStatuses(page);
  const killed = await hostPid(app);
  process.kill(killed, "SIGKILL");
  await expect.poll(() => statuses.jsonValue()).toEqual(["Reconnecting…"]);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await hostPid(app)).not.toBe(killed);
  await expect.poll(() => threadTitles(page)).toEqual(["Second."]);
  await threadRow(page, "Second.").click();
  await expect(message(page, 1)).toHaveText("Done.");
  await page.reload();
  await waitForPi(page);
  await expect.poll(() => threadTitles(page)).toEqual(["Second."]);
  expect(existsSync(selectedFile)).toBe(false);
  expect(readFileSync(siblingFile, "utf8")).toBe(siblingBytes);
  await page.screenshot({ path: path.join(deletionEvidence, "restart.png") });
});

test("deletion refuses a busy turn with Stop-first guidance and leaves the session recoverable", async () => {
  const gate = path.join(workDir, "turn-gate");
  execFileSync("mkfifo", [gate]);
  const { page, profileDir } = await launch({
    responses: [reply("Done."), bashCall(`cat '${gate}'`), reply("Stopped.")],
  });
  await addProject(tondo!, project);
  await waitForPi(page);
  await ask(page, "Busy session", "Done.");
  const folder = sessionFolder(profileDir, project);
  const file = path.join(
    folder,
    readdirSync(folder).find((name) => name.endsWith(".jsonl"))!,
  );
  await send(page, "Keep working");
  await expect(page.getByRole("button", { name: "Stop pi", exact: true })).toBeVisible();
  await chooseThreadAction(page, "Busy session", "Delete…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Stop pi first");
  expect(existsSync(file)).toBe(true);
  await expect(threadRow(page, "Busy session")).toBeVisible();
  await page.screenshot({ path: path.join(deletionEvidence, "busy-refusal.png") });
  await page.getByRole("button", { name: "Stop pi", exact: true }).click();
  await waitForIdle(page);
  await chooseThreadAction(page, "Busy session", "Delete…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect(threadRows(page)).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
});

test("a selected session remains deletable after its local checkout disappears", async () => {
  const { page, profileDir } = await startThread("Missing checkout", "Done.");
  const folder = sessionFolder(profileDir, project);
  const file = path.join(
    folder,
    readdirSync(folder).find((name) => name.endsWith(".jsonl"))!,
  );
  rmSync(project, { recursive: true });
  await chooseThreadAction(page, "Missing checkout", "Delete…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect(threadRows(page)).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  await page.screenshot({ path: path.join(deletionEvidence, "missing-checkout.png") });
});

test("explicit worktree removal retains an addressable session for Delete across restart", async () => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(project, ".gitignore"), "ignored\n");
  git("add", ".");
  git("commit", "-m", "initial");
  const { app, page, profileDir } = await startThread("Local session", "Done.");
  await gitAction(page, "New worktree");
  await page.getByLabel("Branch name", { exact: true }).fill("deletion-preserved");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create worktree thread", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await waitForPi(page);
  await expect(threadRow(page, "New thread")).toHaveCount(0);
  await composer(page).fill("Managed session");
  await expect(threadRow(page, "New thread")).toBeVisible();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(message(page, 1)).toHaveText("Done.");
  await waitForIdle(page);
  const field = git("worktree", "list", "--porcelain", "-z")
    .split("\0")
    .find((entry) => entry.startsWith("worktree ") && entry !== `worktree ${project}`);
  if (!field) throw new Error("No managed checkout");
  const checkout = field.slice(9);
  const folder = sessionFolder(profileDir, checkout);
  const file = path.join(
    folder,
    readdirSync(folder).find((name) => name.endsWith(".jsonl"))!,
  );
  writeFileSync(path.join(checkout, "ignored"), "Keep ignored files");
  await chooseThreadAction(page, "Managed session", "Delete…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("managed worktree first");
  expect(readFileSync(path.join(checkout, "ignored"), "utf8")).toBe("Keep ignored files");
  expect(existsSync(file)).toBe(true);
  expect(git("branch", "--list", "deletion-preserved")).toContain("deletion-preserved");
  await page.screenshot({ path: path.join(deletionEvidence, "managed-refusal.png") });

  await page.getByRole("button", { name: "Git actions", exact: true }).click();
  const removeWorktree = page.getByRole("menuitem", { name: "Remove worktree", exact: true });
  await expect(removeWorktree).toBeEnabled();
  await removeWorktree.click();
  const removal = page.getByRole("alertdialog");
  await removal.getByRole("button", { name: "Remove worktree", exact: true }).click();
  await expect(removal.getByRole("alert")).toContainText("ignored files");
  expect(readFileSync(path.join(checkout, "ignored"), "utf8")).toBe("Keep ignored files");
  expect(existsSync(file)).toBe(true);
  await page.screenshot({ path: path.join(deletionEvidence, "managed-ignored-refusal.png") });
  await removal
    .getByRole("checkbox", { name: "Permanently delete uncommitted and ignored files too" })
    .check();
  await removal.getByRole("button", { name: "Remove worktree", exact: true }).click();
  await expect(removal).toBeHidden();
  expect(existsSync(checkout)).toBe(false);
  expect(existsSync(file)).toBe(true);
  expect(git("branch", "--list", "deletion-preserved")).toContain("deletion-preserved");
  await expect(threadRow(page, "Managed session")).toBeVisible();
  await page.screenshot({
    path: path.join(deletionEvidence, "managed-removed-session-retained.png"),
  });

  await chooseThreadAction(page, "Managed session", "Delete…");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect(threadRow(page, "Managed session")).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  expect(git("branch", "--list", "deletion-preserved")).toContain("deletion-preserved");
  expect(git("worktree", "list", "--porcelain")).not.toContain(checkout);
  await page.screenshot({ path: path.join(deletionEvidence, "managed-deleted.png") });
  const statuses = await recordStatuses(page);
  const killed = await hostPid(app);
  process.kill(killed, "SIGKILL");
  // The preceding removal toast also has role=status. Require the observed
  // reconnect event without depending on when that unrelated toast expires.
  await expect.poll(() => statuses.jsonValue()).toContain("Reconnecting…");
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await hostPid(app)).not.toBe(killed);
  await expect(threadRow(page, "Local session")).toBeVisible();
  await expect(threadRow(page, "Managed session")).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  expect(git("branch", "--list", "deletion-preserved")).toContain("deletion-preserved");
  await page.screenshot({ path: path.join(deletionEvidence, "managed-deleted-restart.png") });
  writeFileSync(
    path.join(deletionEvidence, "managed-filesystem.json"),
    JSON.stringify(
      {
        checkout,
        checkoutExists: existsSync(checkout),
        sessionFile: file,
        sessionExists: existsSync(file),
        branchKept: git("branch", "--list", "deletion-preserved").includes("deletion-preserved"),
        listedThreads: await threadTitles(page),
      },
      null,
      2,
    ),
  );
});

test("a project whose folder was deleted from disk can still be removed", async () => {
  const { page } = await startThread("Before removal.", "Done.");
  rmSync(project, { recursive: true, force: true });
  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");

  await threads(page).getByRole("button", { name: "project", exact: true }).click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  // Git can't start in the missing folder, and that must not stop the removal.
  await expect(threads(page).getByRole("button", { name: "project", exact: true })).toHaveCount(0);
  await expect(threadRows(page)).toHaveCount(0);
});

test("a thread's menu closes on Escape or on a click outside the sidebar", async () => {
  const { page } = await startThread("First.", "Done.");
  const menu = page.getByRole("menu", { name: "Thread actions" });
  const actions = threads(page).getByRole("button", { name: "Thread actions" });

  await threadRow(page, "First.").hover();
  await actions.click();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeAttached();
  await expect(actions).toBeFocused();

  await threadRow(page, "First.").click({ button: "right" });
  await expect(menu).toBeVisible();
  const answer = await message(page, 1).boundingBox();
  if (!answer) throw new Error("The reply isn't on screen");
  await page.mouse.click(answer.x + answer.width / 2, answer.y + answer.height / 2);
  await expect(menu).not.toBeAttached();
});

test("the keyboard moves through the sidebar, opens threads and their menu, and the palette", async () => {
  const { page } = await startThread("Alpha.", "Done.");
  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");
  await waitForPi(page);
  await ask(page, "Beta.", "Done.");
  await expect.poll(() => threadTitles(page)).toEqual(["Beta.", "Alpha."]);
  const header = threads(page).getByRole("button", { name: "project", exact: true });
  const alpha = threadRow(page, "Alpha.");
  const beta = threadRow(page, "Beta.");

  // The list is one Tab stop, which starts at the open thread.
  await threads(page).getByRole("button", { name: "Add project", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(beta).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(alpha).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(beta).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(header).toBeFocused();
  await page.keyboard.press("End");
  await expect(alpha).toBeFocused();
  await page.keyboard.press("Home");
  await expect(header).toBeFocused();

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText("Alpha.");
  await expect(alpha).toHaveAttribute("aria-current", "page");
  await expect(alpha).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(heading(page)).toHaveText("Beta.");
  await expect(beta).toBeFocused();

  const menu = page.getByRole("menu", { name: "Thread actions" });
  await page.keyboard.press("Shift+F10");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeAttached();
  await expect(beta).toBeFocused();

  // Past the row's own button, Tab leaves the list for the sidebar's footer,
  // and then the sidebar.
  await page.keyboard.press("Tab");
  await expect(rowActions(page, "Beta.")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(threads(page).getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await threads(page).evaluate((sidebar) => sidebar.contains(document.activeElement)),
    "Tab leaves the sidebar",
  ).toBe(false);

  // The palette takes focus, and gives it back when Escape closes it.
  await beta.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("combobox", { name: "Search" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeAttached();
  await expect(beta).toBeFocused();

  // Confirmed deletion moves focus to the row beside it.
  await page.keyboard.press("ArrowDown");
  await expect(alpha).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delete…", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete thread", exact: true })
    .click();
  await expect.poll(() => threadTitles(page)).toEqual(["Beta."]);
  await expect(beta).toBeFocused();
});

test("drafts stay with their threads, and Tondo's store keeps them through a host restart", async () => {
  const { app, page } = await startThread("Remember this.", "Noted.");
  await chooseThreadAction(page, "Remember this.", "Pin");
  await composer(page).fill("Half a thought");

  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");
  await expectDraft(page, "");
  await expect(threadRows(page)).toHaveCount(1);
  const first = threadRow(page, "Remember this.");
  await expect(first.getByRole("img", { name: "Unsent draft" })).toBeVisible();
  await composer(page).fill("Another thought");
  // Session titles are rediscovered after a host restart; several rows can
  // temporarily say "New thread", but their stored IDs remain distinct.
  const secondId = await threadRow(page, "New thread").getAttribute("data-thread-id");
  const second = threads(page).locator(`[data-thread-id="${secondId}"]`);
  await expect(second.getByRole("img", { name: "Unsent draft" })).toBeVisible();

  const statuses = await recordStatuses(page);
  const killed = await hostPid(app);
  process.kill(killed, "SIGKILL");
  await expect.poll(() => statuses.jsonValue()).toEqual(["Reconnecting…"]);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await hostPid(app)).not.toBe(killed);

  // The new host reopened the thread that was open, from the store.
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(heading(page)).toHaveText("New thread");
  await expectDraft(page, "Another thought");
  await first.click();
  await expect(heading(page)).toHaveText("Remember this.");
  await expectDraft(page, "Half a thought");
  await expect(message(page, 1)).toHaveText("Noted.");
  // The new host's sidebar reached the page before this thread did, so the
  // pin and the other draft come from the store too.
  await expect(first.getByRole("img", { name: "Pinned" })).toBeVisible();
  await expect(second.getByRole("img", { name: "Unsent draft" })).toBeVisible();
});

const draftScreenshots = path.resolve(".dev/improvements-20261011/qa/drafts");

test("empty drafts stay hidden on create, focus and whitespace, then typing reveals before send", async () => {
  const { page } = await launch({ responses: [] });
  await addProject(tondo!, project);
  await waitForPi(page);
  await expect(threadRows(page)).toHaveCount(0);
  await composer(page).focus();
  await composer(page).fill(" \n\t");
  // Switching flushes whitespace and proves the New thread action still works
  // without a sidebar row for the current thread.
  await page.keyboard.press("ControlOrMeta+n");
  await expectDraft(page, "");
  await waitForPi(page);
  await expect(threadRows(page)).toHaveCount(0);
  await page.screenshot({ path: path.join(draftScreenshots, "empty.png") });
  await composer(page).pressSequentially("A");
  await expect(threadRows(page)).toHaveCount(1);
  await expectDraft(page, "A");
  await expect(page.locator('[data-index="0"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(draftScreenshots, "typed.png") });
  await composer(page).fill("");
  await page.keyboard.press("ControlOrMeta+n");
  await expectDraft(page, "");
  await expect(threadRows(page)).toHaveCount(1);
});

test("pasted text reveals a draft before send", async () => {
  const { app, page } = await launch({ responses: [] });
  await addProject(tondo!, project);
  await waitForPi(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText("Pasted thought"));
  await composer(page).focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expectDraft(page, "Pasted thought");
  await expect(threadRows(page)).toHaveCount(1);
  await expect(page.locator('[data-index="0"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(draftScreenshots, "pasted.png") });
});

test("an image attachment reveals an otherwise empty draft", async () => {
  const { page } = await launch({ responses: [] });
  await addProject(tondo!, project);
  await waitForPi(page);
  await expect(threadRows(page)).toHaveCount(0);
  const file = path.join(workDir, IMAGE_FIXTURE.name);
  writeFileSync(file, Buffer.from(IMAGE_FIXTURE.data, "base64"));
  await pickFiles(tondo!, [file]);
  await expect(page.getByLabel("Attached images", { exact: true })).toBeVisible();
  await expect(threadRows(page)).toHaveCount(1);
  await expectDraft(page, "");
  await page.screenshot({ path: path.join(draftScreenshots, "image.png") });
});

test("extension-only text stays hidden until the user sends it without editing", async () => {
  const extension = path.join(workDir, "draft-extension.ts");
  writeFileSync(
    extension,
    `
    export default function(pi) {
      pi.on("session_start", (_event, ctx) => {
        ctx.ui.setStatus("draft", "Extension ready");
        ctx.ui.setEditorText("Extension suggestion");
      });
    }
  `,
  );
  tondo = await launchWithPi({
    workDir,
    script: { responses: [reply("Accepted the suggestion.")] },
    piArgs: ["-e", extension],
  });
  await bringToFront(tondo);
  const { page } = tondo;
  await addProject(tondo, project);
  await waitForPi(page);
  await expectDraft(page, "Extension suggestion");
  await expect(threadRows(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+n");
  await waitForPi(page);
  await expectDraft(page, "Extension suggestion");
  await expect(threadRows(page)).toHaveCount(0);
  await page.screenshot({ path: path.join(draftScreenshots, "extension-only.png") });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(threadRows(page)).toHaveCount(1);
  await expect(message(page, 0)).toHaveText("Extension suggestion");
  await expect(message(page, 1)).toHaveText("Accepted the suggestion.");
  await waitForIdle(page);
  await page.screenshot({ path: path.join(draftScreenshots, "extension-sent.png") });
});

test("shortcuts and the command palette move between threads", async () => {
  const { page } = await startThread("Alpha.", "Done.");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search" }).fill("new thread");
  await page.keyboard.press("Enter");
  await expect(palette).not.toBeAttached();
  await expect(heading(page)).toHaveText("New thread");
  await waitForPi(page);
  await ask(page, "Beta.", "Done.");
  await expect.poll(() => threadTitles(page)).toEqual(["Beta.", "Alpha."]);

  // Next and previous go down and up the sidebar, and wrap around.
  await page.keyboard.press("ControlOrMeta+Shift+BracketRight");
  await expect(heading(page)).toHaveText("Alpha.");
  await page.keyboard.press("ControlOrMeta+Shift+BracketRight");
  await expect(heading(page)).toHaveText("Beta.");
  await page.keyboard.press("ControlOrMeta+Shift+BracketLeft");
  await expect(heading(page)).toHaveText("Alpha.");
  await page.keyboard.press("ControlOrMeta+1");
  await expect(heading(page)).toHaveText("Beta.");
  await page.keyboard.press("ControlOrMeta+2");
  await expect(heading(page)).toHaveText("Alpha.");

  await page.keyboard.press("ControlOrMeta+b");
  await expect(threads(page)).not.toBeAttached();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(threads(page)).toBeVisible();
});

/** Sends `question` in a thread with no messages, and waits until pi has answered it with `answer`. */
async function ask(page: Page, question: string, answer: string): Promise<void> {
  await send(page, question);
  await expect(message(page, 1)).toHaveText(answer);
  await waitForIdle(page);
}

/** The sidebar row of the thread titled `title`. */
function threadRow(page: Page, title: string) {
  return threads(page).getByTitle(title, { exact: true });
}

/** The "Thread actions" button beside the row of the thread titled `title`. */
function rowActions(page: Page, title: string) {
  return threads(page)
    .getByRole("listitem")
    .filter({ has: page.getByTitle(title, { exact: true }) })
    .getByRole("button", { name: "Thread actions" });
}

/** Opens the header's Git actions menu, and chooses `action` in it. */
async function gitAction(page: Page, action: string): Promise<void> {
  await page.getByRole("button", { name: "Git actions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Right-clicks the row of the thread titled `title`, and chooses `action` in its menu. */
async function chooseThreadAction(page: Page, title: string, action: string): Promise<void> {
  await threadRow(page, title).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Thread actions" });
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Clicks "Show `more` more" in the sidebar, and waits until it lists `total` threads. */
async function showMore(page: Page, more: number, total: number): Promise<void> {
  await threads(page)
    .getByRole("button", { name: `Show ${more} more` })
    .click();
  await expect(threadRows(page)).toHaveCount(total);
}

/** The titles of the threads the sidebar lists, top to bottom. */
function threadTitles(page: Page): Promise<string[]> {
  return threadRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("title") ?? ""));
}

/** The open thread's title, in the header. */
function heading(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

/** The timeline's row at `index`, counting from the first message. */
function message(page: Page, index: number) {
  return page.locator(`[data-index="${index}"]`);
}

/** The names pi saved in the session files in `folder`. */
function savedNames(folder: string): string[] {
  return readdirSync(folder).flatMap((file) =>
    readFileSync(path.join(folder, file), "utf8")
      .split("\n")
      .filter((line) => line.includes('"type":"session_info"'))
      .map((line) => (JSON.parse(line) as { name?: string }).name ?? ""),
  );
}

/**
 * Measures, in the page, the time from the next click to the moment the
 * sidebar lists a thread titled `title`. It watches the DOM, so it doesn't
 * need frames.
 */
function timeToListed(page: Page, title: string) {
  return page.evaluateHandle(
    ({ row, wanted }) => {
      let clickedAt: number | undefined;
      window.addEventListener("click", () => (clickedAt = performance.now()), {
        capture: true,
        once: true,
      });
      const listed = () =>
        [...document.querySelectorAll(`nav ${row}`)].some(
          (element) => element.getAttribute("title") === wanted,
        );
      const done = new Promise<number>((resolve) => {
        const observer = new MutationObserver(() => {
          if (clickedAt === undefined || !listed()) return;
          observer.disconnect();
          resolve(performance.now() - clickedAt);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
      return { done };
    },
    { row: THREAD_ROW, wanted: title },
  );
}
