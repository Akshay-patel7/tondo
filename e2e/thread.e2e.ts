// One thread with the real pi, offline with the faux model: prompts, stopping,
// the queue, the model picker, retries, project trust, and pi crashing.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  composer,
  failure,
  launchWithPi,
  PI_START_TIMEOUT_MS,
  recordStatuses,
  reply,
  send,
  waitForFileCommand,
  waitForIdle,
  waitForPi,
  words,
} from "./pi";
import { piGroup } from "./processes";

test.describe.configure({ timeout: 60_000 });

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-thread-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

/** Launches Tondo with the faux model answering from `script`, and opens the project. */
async function launch(script: FauxScript): Promise<Page> {
  tondo = await launchWithPi({ workDir, script });
  // The page applies pi's events once a frame, and a window you can't see gets no frames.
  await bringToFront(tondo);
  await addProject(tondo, project);
  return tondo.page;
}

/** Launches Tondo, opens the project, and waits until pi takes prompts. */
async function start(script: FauxScript): Promise<Page> {
  const page = await launch(script);
  await waitForPi(page);
  return page;
}

test("pi's reply streams in as pi writes it", async () => {
  const answer = words(300);
  const page = await start({ tokensPerSecond: 500, responses: [reply(answer)] });
  const lengths = await recordReplyLengths(page);

  await send(page, "Say something long.");
  await expect(composer(page)).toHaveValue("");
  await expect(row(page, 0)).toHaveText("Say something long.");
  await waitForIdle(page);

  await expect(row(page, 1)).toHaveText(answer);
  const seen = await lengths.evaluate(({ done }) => done);
  // The page showed the reply growing, piece by piece, before pi finished it.
  expect(seen.length).toBeGreaterThan(2);
  expect(seen).toEqual(seen.toSorted((a, b) => a - b));
  expect(Math.max(...seen)).toBeLessThanOrEqual(answer.length);
});

test("Escape stops pi mid-reply", async () => {
  const answer = words(3000);
  const page = await start({
    tokensPerSecond: 200,
    responses: [reply(answer), reply("Still here.")],
  });
  await send(page, "Say something very long.");
  await expect(page.locator("[data-streaming]")).toContainText("word20");

  await composer(page).press("Escape");
  await waitForIdle(page);
  await expect(page.locator("[data-streaming]")).not.toBeAttached();
  // The part pi wrote stays, marked as stopped. The words are the faux model's abort message.
  const stopped = row(page, 1);
  await expect(stopped).toContainText("word20");
  await expect(stopped).not.toContainText("word2999");
  await expect(stopped).toContainText("Request was aborted");

  // pi takes the next prompt.
  await send(page, "Are you there?");
  await expect(row(page, 3)).toHaveText("Still here.");
});

test("Enter steers pi and Alt+Enter queues a follow-up, and pi takes both in turn", async () => {
  const release = path.join(workDir, "release");
  const page = await start({
    responses: [bashCall(waitForFileCommand(release)), reply("Steered."), reply("Followed up.")],
  });
  // pi's bash command holds the turn open until the test creates the release file.
  await send(page, "Start.");
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();

  await send(page, "Steer this.");
  await send(page, "Then this.", "Alt+Enter");
  const queue = page.getByRole("region", { name: "Queued messages" });
  await expect(queue.getByRole("listitem")).toHaveText([
    "Steering: Steer this.",
    "Follow-up: Then this.",
  ]);

  writeFileSync(release, "");
  await waitForIdle(page);
  await expect(queue).not.toBeAttached();
  const texts = await rowTexts(page);
  const order = ["Start.", "Steer this.", "Steered.", "Then this.", "Followed up."].map((text) =>
    texts.indexOf(text),
  );
  expect(order).not.toContain(-1);
  expect(order).toEqual(order.toSorted((a, b) => a - b));
});

test("Alt+Up and Escape take queued messages back into the composer", async () => {
  const page = await start({
    responses: [bashCall(waitForFileCommand(path.join(workDir, "never")))],
  });
  const input = composer(page);
  const queue = page.getByRole("region", { name: "Queued messages" });
  await send(page, "Start.");
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();

  // Alt+Up puts the queue ahead of what you're writing.
  await send(page, "First.", "Alt+Enter");
  await expect(queue).toContainText("Follow-up: First.");
  await input.fill("A draft.");
  await input.press("Alt+ArrowUp");
  await expect(input).toHaveValue("First.\n\nA draft.");
  await expect(queue).not.toBeAttached();
  // pi still works.
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeVisible();

  // Escape takes the queue back, then stops pi.
  await send(page, "Second.", "Alt+Enter");
  await expect(queue).toContainText("Follow-up: Second.");
  await input.press("Escape");
  await waitForIdle(page);
  await expect(input).toHaveValue("Second.");
  await expect(queue).not.toBeAttached();
});

test("a model you pick is the one pi reports", async () => {
  const page = await start({ responses: [reply("Hello from Faux 2.")] });
  const model = page.getByLabel("Model");
  await expect(model).toHaveValue("faux/faux-1");
  await expect(page.getByLabel("Thinking level")).toBeVisible();

  await model.selectOption("faux/faux-2");
  // pi's get_state names the model, and pi offers no thinking levels for a
  // model without reasoning. Its context window is Faux 2's.
  await expect(model).toHaveValue("faux/faux-2");
  await expect(page.getByLabel("Thinking level")).toBeHidden();
  const meter = page.getByRole("img", { name: /^Context window/ });
  await expect(meter).toHaveAttribute("title", /\b200k token/);

  await send(page, "Hello?");
  await expect(row(page, 1)).toHaveText("Hello from Faux 2.");
  await expect(meter).toHaveAttribute("title", /of 200k tokens/);

  // A new page gets the model from the host's copy of pi's state.
  await page.reload();
  await expect(page.getByLabel("Model")).toHaveValue("faux/faux-2");
});

test("a failed request shows pi's retry, then the reply", async () => {
  const page = await start({
    responses: [failure("503 Service Unavailable"), reply("Recovered.")],
  });
  const statuses = await recordStatuses(page);

  await send(page, "Hello?");
  await expect(page.getByText("Recovered.")).toBeVisible();
  await waitForIdle(page);
  // The banner showed while pi waited to retry, and went once pi's retry worked.
  expect(await statuses.jsonValue()).toContainEqual(
    "Retrying (1/3) in 2 s. Escape cancels.503 Service Unavailable",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("a project that needs trust asks first, and Tondo remembers the answer", async () => {
  // pi asks about a project with its own .pi settings, and applies them only
  // in a project you trust.
  mkdirSync(path.join(project, ".pi"));
  writeFileSync(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({ defaultThinkingLevel: "low" }),
  );
  const page = await launch({ responses: [] });
  const question = page.getByRole("region", { name: "Trust project folder?" });
  await expect(question).toBeVisible();
  await expect(question).toContainText(project);

  await question.getByRole("button", { name: "Trust", exact: true }).click();
  await waitForPi(page);
  const thinking = page.getByLabel("Thinking level");
  await expect(thinking).toHaveValue("low");
  const settings = JSON.parse(readFileSync(path.join(tondo!.profileDir, "settings.json"), "utf8"));
  expect(settings.projectTrust).toEqual({ [project]: true });

  // A new thread in the project starts a new pi without asking. A level you
  // pick lasts only as long as its pi, so "low" again comes from the new pi,
  // which didn't wait for an answer and still trusts the project.
  await thinking.selectOption("high");
  await expect(thinking).toHaveValue("high");
  await page.keyboard.press("ControlOrMeta+n");
  await expect(thinking).toHaveValue("low", { timeout: PI_START_TIMEOUT_MS });
  await expect(question).not.toBeAttached();
});

test("after pi crashes, a restart brings the thread back", async () => {
  const page = await start({ responses: [reply("Hello.")] });
  await send(page, "Hi.");
  await expect(row(page, 1)).toHaveText("Hello.");
  await waitForIdle(page);

  const crashed = await piGroup(tondo!.app);
  process.kill(crashed, "SIGKILL");
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("pi was killed by SIGKILL.");
  await expect(page.getByLabel("Model")).toBeHidden();

  await banner.getByRole("button", { name: "Restart pi" }).click();
  await waitForPi(page);
  await expect(banner).not.toBeAttached();
  expect(await piGroup(tondo!.app)).not.toBe(crashed);
  // The new pi opened the session file, and the host sent its transcript.
  await expect(row(page, 0)).toHaveText("Hi.");
  await expect(row(page, 1)).toHaveText("Hello.");

  // The faux model starts its script again in a new pi.
  await send(page, "Hi again.");
  await expect(row(page, 3)).toHaveText("Hello.");
});

/** The timeline's row at `index`, counting from the first message. */
function row(page: Page, index: number) {
  return page.locator(`[data-index="${index}"]`);
}

/** The text of each row on the page, in the timeline's order, which the DOM's order needn't follow. */
function rowTexts(page: Page): Promise<string[]> {
  return page.locator("[data-index]").evaluateAll((rows) =>
    rows
      .map((element) => ({
        index: Number(element.getAttribute("data-index")),
        text: element.textContent?.trim() ?? "",
      }))
      .toSorted((a, b) => a.index - b.index)
      .map(({ text }) => text),
  );
}

/**
 * Records the length of the reply streaming in, each time it changes, from
 * now until pi finishes it. It watches the DOM, so it doesn't need frames.
 */
function recordReplyLengths(page: Page) {
  return page.evaluateHandle(() => {
    const lengths: number[] = [];
    let seenReply = false;
    const done = new Promise<number[]>((resolve) => {
      const observer = new MutationObserver(() => {
        const streaming = document.querySelector("[data-streaming]");
        if (streaming) {
          seenReply = true;
          const length = streaming.textContent?.length ?? 0;
          if (length !== lengths.at(-1)) lengths.push(length);
        } else if (seenReply) {
          observer.disconnect();
          resolve(lengths);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    return { done };
  });
}
