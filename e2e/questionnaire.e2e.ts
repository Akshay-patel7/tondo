import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import { addProject, launchWithPi, reply, send, toolCalls, waitForPi } from "./pi";

test.describe.configure({ timeout: 60_000 });
const EXTENSION = path.resolve(__dirname, "../scripts/fixtures/questionnaire-ext.ts");
const questions = [
  {
    header: "Hosting",
    question: "Where should this run?",
    options: [
      { label: "Local", description: "On this machine" },
      { label: "Cloud", description: "On a server", preview: "host: cloud\nreplicas: 2" },
    ],
  },
  {
    header: "Checks",
    question: "Which checks should run?",
    multiSelect: true,
    options: [
      { label: "Unit", description: "Fast checks" },
      { label: "E2E", description: "Real app" },
    ],
  },
  {
    header: "Name",
    question: "What should it be called?",
    options: [
      { label: "Alpha", description: "First name" },
      { label: "Beta", description: "Second name" },
    ],
  },
  {
    header: "Extras",
    question: "Any extra checks?",
    multiSelect: true,
    options: [
      { label: "Lint", description: "Style checks" },
      { label: "Types", description: "Type checks" },
    ],
  },
];
let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-questionnaire-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});
test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

async function start(theme: "light" | "dark" = "light", items = questions) {
  tondo = await launchWithPi({
    workDir,
    settings: { theme },
    piArgs: ["-e", EXTENSION],
    script: {
      responses: [
        toolCalls({ name: "ask_user_question", arguments: { questions: items } }),
        reply("Received answers."),
      ],
    },
  });
  await bringToFront(tondo);
  await tondo.page.emulateMedia({ colorScheme: null });
  await expect
    .poll(() => tondo!.page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
    .toBe(theme === "dark");
  await addProject(tondo, project);
  await waitForPi(tondo.page);
  await send(tondo.page, "Ask me the questions.");
  return tondo.page;
}

for (const theme of ["light", "dark"] as const) {
  test(`browse ahead, go back and edit answers before submitting in ${theme}`, async () => {
    const page = await start(theme);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const form = page.getByRole("dialog", { name: "Questions", exact: true });
    const recorded = path.join(project, "question-answers.jsonl");
    await expect(form).toBeVisible();
    await expect(form.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(form.getByRole("heading", { name: "Which checks should run?" })).toBeFocused();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(form.getByRole("heading", { name: "What should it be called?" })).toBeFocused();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(form.getByRole("heading", { name: "Which checks should run?" })).toBeFocused();
    await form.getByRole("button", { name: "Question 4: Extras" }).click();
    await expect(form.getByRole("button", { name: "Submit answers" })).toBeDisabled();
    await form.getByRole("button", { name: "Question 1: Hosting" }).click();
    await form.getByRole("button", { name: /^Cloud/ }).click();
    await expect(form.getByRole("heading", { name: "Which checks should run?" })).toBeFocused();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByText("host: cloud\nreplicas: 2", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("options.png"), animations: "disabled" });
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await form.getByRole("button", { name: /^Unit/ }).click();
    await form.getByRole("button", { name: /^E2E/ }).click();
    await form.getByRole("textbox", { name: "Your answer" }).fill("Also security; and docs");
    await page.screenshot({ path: test.info().outputPath("multi.png"), animations: "disabled" });
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await form.getByRole("button", { name: /^Alpha/ }).focus();
    await page.keyboard.press("Enter");
    await expect(form.getByRole("heading", { name: "Any extra checks?" })).toBeFocused();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("button", { name: /^Alpha/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await form.getByRole("textbox", { name: "Your answer" }).fill("2");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(form.getByRole("button", { name: "Submit answers" })).toBeEnabled();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("textbox", { name: "Your answer" })).toHaveValue("2");
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("button", { name: /^Unit/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByRole("button", { name: /^E2E/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByRole("textbox", { name: "Your answer" })).toHaveValue(
      "Also security; and docs",
    );
    await form.getByRole("button", { name: /^Unit/ }).click();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("button", { name: /^Cloud/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await form.getByRole("button", { name: /^Local/ }).click();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("textbox", { name: "Your answer" })).toHaveValue("");
    await form.getByRole("textbox", { name: "Your answer" }).fill("My own host");
    await expect(form.getByRole("button", { name: /^Local/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await form.getByRole("button", { name: /^Local/ }).click();
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.getByRole("textbox", { name: "Your answer" })).toHaveValue("");
    await form.getByRole("button", { name: "Question 4: Extras" }).click();
    await page.setViewportSize({ width: 900, height: 700 });
    await page.screenshot({
      path: test.info().outputPath("review-small.png"),
      animations: "disabled",
    });
    expect(existsSync(recorded)).toBe(false);
    await form.getByRole("button", { name: "Submit answers" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText("Received answers.", { exact: true })).toBeVisible();
    expect(
      readFileSync(recorded, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { option: "Local" },
      { selected: ["E2E"], text: "Also security; and docs" },
      { text: "2" },
      { selected: [], text: "" },
    ]);
    expect(errors).toEqual([]);
  });
}

test("selecting the last single-choice answer still waits for Submit", async () => {
  const page = await start("light", questions.slice(0, 1));
  const form = page.getByRole("dialog", { name: "Questions", exact: true });
  await form.getByRole("button", { name: /^Local/ }).click();
  await expect(form.getByRole("heading", { name: "Where should this run?" })).toBeVisible();
  await expect(form.getByRole("button", { name: /^Local/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(existsSync(path.join(project, "question-answers.jsonl"))).toBe(false);
  await form.getByRole("button", { name: "Submit answers" }).click();
  await expect(page.getByText("Received answers.", { exact: true })).toBeVisible();
  expect(readFileSync(path.join(project, "question-answers.jsonl"), "utf8").trim()).toBe(
    '{"option":"Local"}',
  );
});

test("Escape cancels the whole questionnaire without sending draft answers", async () => {
  const page = await start();
  const form = page.getByRole("dialog", { name: "Questions", exact: true });
  await form.getByRole("button", { name: /^Local/ }).click();
  await form.getByRole("button", { name: "Question 3: Name" }).click();
  await form.getByRole("textbox", { name: "Your answer" }).fill("A draft");
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(page.getByText("Received answers.", { exact: true })).toBeVisible();
  expect(readFileSync(path.join(project, "question-answers.jsonl"), "utf8").trim()).toBe(
    '{"cancelled":true}',
  );
});
