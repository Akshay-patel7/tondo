// Tool cards: every built-in tool and an extension's tool from a recorded
// turn, a shell command's output while it runs, and edit diffs highlighted by
// @pierre/diffs's worker pool under the CSP.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, type Tondo } from "./launch";
import {
  addProject,
  bashCall,
  launchWithPi,
  PI_START_TIMEOUT_MS,
  reply,
  send,
  toolCalls,
  waitForFileCommand,
  waitForPi,
} from "./pi";
import { seedSession } from "./sessions";

test.describe.configure({ timeout: 60_000 });

let workDir: string;
let project: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-tools-e2e-")));
  project = path.join(workDir, "project");
  mkdirSync(project);
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

/** The card of the tool call with id `id`. */
function card(page: Page, id: string): Locator {
  return page.locator(`[data-tool-call="${id}"]`);
}

/** The button that opens and closes a card. */
function header(of: Locator): Locator {
  return of.getByRole("button").first();
}

/** Collects CSP violations in the page from now on. */
function recordCspViolations(page: Page) {
  return page.evaluateHandle(() => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`),
    );
    return violations;
  });
}

/** What a highlighted code view shows once a worker has colored it. */
async function waitForHighlighting(of: Locator): Promise<void> {
  await expect
    .poll(() =>
      of
        .locator("diffs-container")
        .evaluate(
          (host) => host.shadowRoot?.querySelector('span[style*="--diffs-token"]') !== null,
        ),
    )
    .toBe(true);
}

test("every built-in tool and an extension's tool get a card that opens to its output", async () => {
  // A turn pi really ran, recorded by `pnpm fixtures tool-cards`.
  const session = seedSession(workDir, project, { fixture: "tool-cards.json" });
  tondo = await launchWithPi({ workDir, script: { responses: [] }, piArgs: ["--fork", session] });
  const { page } = tondo;
  await bringToFront(tondo);
  const violations = await recordCspViolations(page);
  await addProject(tondo, project);
  // 13 messages, and the 9 results show inside their calls' cards.
  await expect(page.locator('[data-index="12"]')).toContainText("The parser skips spaces now", {
    timeout: PI_START_TIMEOUT_MS,
  });
  await expect(page.locator("[data-index]")).toHaveCount(4);
  await page.screenshot({ path: test.info().outputPath("closed.png"), animations: "disabled" });

  const cards: [id: string, header: string, body: string][] = [
    ["look_0", "ls src", "parser.ts"],
    ["look_1", "find *.ts", "src/lexer.ts"],
    ["look_2", "grep export function in src", "parser.ts:8: export function parse"],
    ["look_3", "read src/parser.ts", "export function parse(source: string): Node[] {"],
    ["look_4", "bash wc -l src/*.ts", "29 total"],
    ["look_5", "powershell Get-ChildItem src", "The powershell tool is only available on Windows."],
    ["look_6", 'word_count {"path":"README.md"}', "README.md has 11 words."],
    ["change_0", "edit src/parser.ts +1 −0", 'if (token.type === "space") continue;'],
    ["change_1", "write src/kinds.ts 3 lines", "export const KINDS"],
  ];
  for (const [id, title, body] of cards) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one card at a time, each opened and photographed in turn.
    await openCard(page, id, title, body);
  }
  // The extension's tool gets the generic card, with its arguments.
  await expect(card(page, "look_6")).toContainText('"path": "README.md"');

  // The diffs came from the worker pool, and the CSP let everything load.
  expect(page.workers().some((worker) => /worker-[\w-]+\.js$/.test(worker.url()))).toBe(true);
  expect(await violations.jsonValue()).toEqual([]);
});

test("a running command shows its last lines under its card until it ends", async () => {
  const release = path.join(workDir, "release");
  // More lines than an open card shows at once, so its output scrolls.
  const lines = Array.from({ length: 30 }, (_, index) => `echo line${index + 1}`).join("; ");
  tondo = await launchWithPi({
    workDir,
    script: {
      responses: [
        bashCall(`${lines}; ${waitForFileCommand(release)}; echo finished`, "call_run"),
        reply("Ran it."),
      ],
    },
  });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Run it.");

  const running = card(page, "call_run");
  await expect(running).toHaveAttribute("data-status", "running");
  const latest = running.getByRole("log", { name: "Latest output" });
  await expect(latest).toHaveText(["line26", "line27", "line28", "line29", "line30"].join("\n"));

  // Open, the card shows the output from its end, and stays there as the
  // command finishes.
  await header(running).click();
  await expect(latest).not.toBeAttached();
  await expect(running).toContainText("line30");
  writeFileSync(release, "");
  await expect(running).toHaveAttribute("data-status", "done");
  await expect(running).toContainText("finished");
  await expect.poll(() => pixelsBelowView(running)).toBeLessThan(18);
  await expect(page.getByText("Ran it.")).toBeVisible();

  // Closed, a finished command shows no output.
  await header(running).click();
  await expect(latest).not.toBeAttached();
});

test("an edit shows its diff, and a failed call its error", async () => {
  writeFileSync(path.join(project, "notes.md"), "# Notes\n\nfirst\n");
  tondo = await launchWithPi({
    workDir,
    script: {
      responses: [
        toolCalls(
          {
            id: "call_edit",
            name: "edit",
            arguments: {
              path: "notes.md",
              edits: [{ oldText: "first\n", newText: "first\nsecond\n" }],
            },
          },
          {
            id: "call_missing",
            name: "edit",
            arguments: { path: "missing.md", edits: [{ oldText: "a", newText: "b" }] },
          },
        ),
        reply("Edited."),
      ],
    },
  });
  const { page } = tondo;
  await bringToFront(tondo);
  await addProject(tondo, project);
  await waitForPi(page);
  await send(page, "Add a line.");
  await expect(page.getByText("Edited.")).toBeVisible();

  const edited = card(page, "call_edit");
  await expect(header(edited)).toHaveText("edit notes.md +1 −0");
  await header(edited).click();
  await waitForHighlighting(edited);
  await expect(edited).toContainText("second");

  const missing = card(page, "call_missing");
  await expect(missing).toHaveAttribute("data-status", "failed");
  await header(missing).click();
  await expect(missing).toContainText("missing.md");
});

/** How far the card's output box is scrolled from its end. */
function pixelsBelowView(of: Locator): Promise<number> {
  return of
    .locator("[tabindex='0']")
    .evaluate((box) => box.scrollHeight - box.scrollTop - box.clientHeight);
}

/** Checks a closed card's header and status, opens it, checks its body and takes its picture. */
async function openCard(page: Page, id: string, title: string, body: string): Promise<void> {
  const toolCard = card(page, id);
  await toolCard.scrollIntoViewIfNeeded();
  await expect(header(toolCard)).toHaveText(title);
  await expect(toolCard).toHaveAttribute("data-status", id === "look_5" ? "failed" : "done");
  await expect(header(toolCard)).toHaveAttribute("aria-expanded", "false");
  await header(toolCard).click();
  await expect(header(toolCard)).toHaveAttribute("aria-expanded", "true");
  await expect(toolCard).toContainText(body);
  if (id === "look_3" || id === "change_0" || id === "change_1")
    await waitForHighlighting(toolCard);
  await toolCard.screenshot({ path: test.info().outputPath(`${id}.png`), animations: "disabled" });
}
