import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  launchWithPi,
  longReply,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
} from "./pi";
import { sessionFolder } from "./sessions";

let dir: string;
let tondo: Tondo;
let title: string;

test.beforeEach(async () => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-history-e2e-")));
  const project = path.join(dir, "project");
  const profileDir = path.join(dir, "profile");
  mkdirSync(project);
  mkdirSync(profileDir);
  const folder = sessionFolder(process.env.TONDO_E2E_EXECUTABLE ? dir : profileDir, project);
  mkdirSync(folder, { recursive: true });
  const stamp = Date.now() - 60_000;
  title = "Original history request";
  const messages: Parameters<SessionManager["appendMessage"]>[0][] = [
    { role: "user", content: title, timestamp: stamp },
    {
      ...reply(""),
      content: [
        {
          type: "toolCall",
          id: "saved-call",
          name: "bash",
          arguments: { command: "echo archived" },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "saved-call",
      toolName: "bash",
      content: [{ type: "text", text: "Archived command output" }],
      isError: false,
      timestamp: stamp + 2,
    },
    ...Array.from({ length: 80 }, (_, i) => reply(`Saved answer section ${i}.`)),
    { role: "user", content: "Second saved request", timestamp: stamp + 3 },
    reply("Second saved answer"),
    { role: "user", content: "Third saved request", timestamp: stamp + 4 },
    reply("Third saved answer"),
    { role: "user", content: "Current retained request", timestamp: stamp + 5 },
    reply("Live retained answer"),
  ];
  const single = test.info().title.startsWith("a single");
  if (single)
    messages.splice(
      0,
      messages.length,
      { role: "user", content: title, timestamp: stamp },
      reply("Only retained reply"),
    );
  else
    messages.splice(
      63,
      0,
      {
        ...reply(""),
        content: [
          {
            type: "toolCall",
            id: "boundary-call",
            name: "bash",
            arguments: { command: "echo boundary" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "boundary-call",
        toolName: "bash",
        content: [{ type: "text", text: "Boundary command output" }],
        isError: false,
        timestamp: stamp + 2,
      },
    );
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const session = SessionManager.inMemory(project);
  // Use pi's serializer, including custom state with identity after data.
  session.appendCustomEntry("initial-state", { phase: "idle" });
  const ids = messages.map((message, index) => {
    const id = session.appendMessage(message);
    if (index === 0)
      session.appendCustomEntry("large-state", {
        message: { role: "user", id: "fake", parentId: "fake" },
        payload: "extension state ".repeat(20_000),
      });
    return id;
  });
  session.appendCompaction("Earlier work summarized.", ids.at(single ? -1 : -2)!, 5000);
  session.appendCustomEntry("final-state", { phase: "idle" });
  writeFileSync(
    path.join(folder, `${session.getSessionId()}.jsonl`),
    [session.getHeader(), ...session.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  const streamedReply = longReply();
  tondo = await launchWithPi({
    workDir: dir,
    profileDir,
    script: {
      tokensPerSecond: 1000,
      responses: [
        {
          ...streamedReply,
          content: [
            ...streamedReply.content,
            { type: "text", text: "Live reply completed without history changes." },
          ],
        },
      ],
    },
  });
  await bringToFront(tondo);
  await addProject(tondo, project);
  await threadRows(tondo.page).filter({ hasText: title }).click();
  await waitForPi(tondo.page);
});

test.afterEach(async () => {
  await tondo?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("compacted history previews, loads bounded sections, resolves old tools, and returns to live", async () => {
  const { page } = tondo;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await expect(navigator).toBeVisible();
  // Loading the index must not mount the old transcript.
  await expect(page.getByRole("article", { name: "You", exact: true })).toHaveText(
    "Current retained request",
  );
  await navigator.focus();
  await navigator.press("Home");
  await expect(page.getByRole("tooltip")).toContainText("Message 1 of 4");
  await expect(page.getByRole("tooltip")).toContainText(title);
  await expect(page.getByRole("tooltip")).toContainText("Saved answer section 79.");
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: test.info().outputPath("saved-history-preview-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("saved-history-preview-dark.png") });
  await navigator.press("Enter");
  await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(title);
  await expect(page.getByRole("button", { name: "Back to live" })).toBeVisible();
  await expect(page.getByText("Archived command output", { exact: true })).toBeVisible();
  await page
    .locator('[data-tool-call="saved-call"]')
    .getByText("Run bash command", { exact: true })
    .click();
  await expect(page.getByText("echo archived", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.locator("[data-virtual-row]").count()).toBeLessThan(20);
  await page.screenshot({ path: test.info().outputPath("saved-history-tools-dark.png") });
  await expect(page.locator('[data-tool-call="boundary-call"]')).toHaveAttribute(
    "data-status",
    "unloaded",
  );
  await page.getByRole("button", { name: "Next section" }).click();
  await expect(page.getByText("Boundary command output", { exact: true })).toBeInViewport();
  await expect(page.getByText("Saved answer section 79.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous section" }).click();
  await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(title);
  await navigator.focus();
  await navigator.press("End");
  await navigator.press("Enter");
  await expect(page.getByRole("article", { name: "You", exact: true })).toHaveText(
    "Current retained request",
  );
  await expect(page.getByRole("article", { name: "You", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "true");
  await expect(page.getByText("Live retained answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Archived command output", { exact: true })).not.toBeAttached();
  expect(errors).toEqual([]);
});

test("a single summarized prompt remains reachable when no user prompts are retained", async () => {
  const { page } = tondo;
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await expect(navigator).toBeVisible();
  await navigator.focus();
  await navigator.press("Home");
  await expect(page.getByRole("tooltip")).toContainText("Message 1 of 1");
  await expect(page.getByRole("tooltip")).toContainText(title);
  await navigator.press("Enter");
  await expect(page.getByRole("article", { name: "You", exact: true })).toHaveText(title);
  await expect(page.getByRole("region", { name: "Transcript", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Back to live" }).click();
  await expect(page.getByText("Only retained reply", { exact: true })).toBeVisible();
});

test("history does not replace live streaming state and survives reload and cold restart", async () => {
  test.setTimeout(90_000);
  let { page } = tondo;
  await send(page, "Continue with a long answer");
  const navigator = page.getByRole("button", { name: "Browse past messages" });
  await navigator.focus();
  await navigator.press("Home");
  await navigator.press("Enter");
  await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(title);
  await waitForIdle(page, { timeout: 45_000 });
  await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(title);
  await page.getByRole("button", { name: "Back to live" }).click();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-following", "true");
  await expect(
    page.getByText("Live reply completed without history changes.", { exact: true }),
  ).toBeVisible();
  const oldNavigator = await navigator.elementHandle();
  await send(page, "/reload");
  await expect.poll(() => oldNavigator!.evaluate((node) => node.isConnected)).toBe(false);
  await oldNavigator!.dispose();
  await waitForPi(page);
  await page.getByRole("button", { name: "Browse past messages" }).focus();
  await page.getByRole("button", { name: "Browse past messages" }).press("Home");
  await expect(page.getByRole("tooltip")).toContainText(title);
  const profileDir = tondo.profileDir;
  await tondo.close();
  tondo = await launchTondo({ profileDir });
  ({ page } = tondo);
  await waitForPi(page);
  const restored = page.getByRole("button", { name: "Browse past messages" });
  await restored.focus();
  await restored.press("Home");
  await expect(page.getByRole("tooltip")).toContainText(title);
  await restored.press("Enter");
  await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(title);
  await page.getByRole("button", { name: "Back to live" }).click();
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByRole("button", { name: "Browse past messages" })).not.toBeAttached();
  await expect(page.getByText("Archived command output", { exact: true })).not.toBeAttached();
  await threadRows(page).filter({ hasText: title }).click();
  await waitForPi(page);
  const reopened = page.getByRole("button", { name: "Browse past messages" });
  await reopened.focus();
  await reopened.press("Home");
  await expect(page.getByRole("tooltip")).toContainText(title);
});
