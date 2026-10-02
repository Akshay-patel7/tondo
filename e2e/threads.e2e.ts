// Projects and their threads with the real pi, offline with the faux model:
// the sidebar over pi's session files, resuming a session, the process pool,
// what Tondo's store keeps, and the command palette and shortcuts.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { bringToFront, hostPid, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
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

test.describe.configure({ timeout: 60_000 });

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

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

  // The thread Tondo opened comes first, then the sessions by when they were
  // last active. The sidebar shows 10 and adds 25 a click.
  await expect(threadRows(page)).toHaveCount(10);
  for (let shown = 10; shown < 501;) {
    const more = Math.min(501 - shown, 25);
    shown += more;
    // oxlint-disable-next-line eslint/no-await-in-loop -- each click lists the threads after the ones the click before listed.
    await showMore(page, more, shown);
  }
  await expect(threads(page).getByRole("button", { name: /^Show \d+ more$/ })).toHaveCount(0);
  expect(await threadTitles(page)).toEqual(["New thread", ...sessions.map(({ title }) => title)]);
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

test("threads get renamed, pinned and archived, and the palette brings one back", async () => {
  const { page, profileDir } = await startThread("First.", "Done.");

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

  await chooseThreadAction(page, "Parser rewrite", "Archive");
  await expect.poll(() => threadTitles(page)).toEqual(["Second."]);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search" }).fill("parser");
  await expect(palette.getByRole("option")).toHaveCount(1);
  const archived = palette.getByRole("group", { name: "Archived threads" });
  await expect(archived.getByRole("option")).toContainText("Parser rewrite");
  await page.keyboard.press("Enter");
  await expect(palette).not.toBeAttached();
  // Choosing it opened it and took it out of the archive, still pinned.
  await expect(heading(page)).toHaveText("Parser rewrite");
  await expect(message(page, 1)).toHaveText("Done.");
  await expect.poll(() => threadTitles(page)).toEqual(["Parser rewrite", "Second."]);
  await expect(
    threadRow(page, "Parser rewrite").getByRole("img", { name: "Pinned" }),
  ).toBeVisible();
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

test("drafts stay with their threads, and Tondo's store keeps them through a host restart", async () => {
  const { app, page } = await startThread("Remember this.", "Noted.");
  await chooseThreadAction(page, "Remember this.", "Pin");
  await composer(page).fill("Half a thought");

  await page.keyboard.press("ControlOrMeta+n");
  await expect(heading(page)).toHaveText("New thread");
  await expectDraft(page, "");
  const first = threadRow(page, "Remember this.");
  await expect(first.getByRole("img", { name: "Unsent draft" })).toBeVisible();
  await composer(page).fill("Another thought");
  const second = threadRow(page, "New thread");
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
  await first.click();
  await expect(heading(page)).toHaveText("Remember this.");
  await expectDraft(page, "Half a thought");
  await expect(message(page, 1)).toHaveText("Noted.");
  // The new host's sidebar reached the page before this thread did, so the
  // pin and the other draft come from the store too.
  await expect(first.getByRole("img", { name: "Pinned" })).toBeVisible();
  await expect(second.getByRole("img", { name: "Unsent draft" })).toBeVisible();
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
