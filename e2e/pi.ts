// Helpers for tests that run the real pi, offline with pi-ai's faux provider.
// The faux model answers each model call with the next reply in the test's
// script. Every pi a test starts reads the script from the top.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { launchTondo, type LaunchOptions, type Tondo } from "./launch";

const repoRoot = path.resolve(__dirname, "..");

/** The pi that pnpm installed. */
export const PI_CLI = path.join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
);

/** pi's arguments in tests: the faux model, and nothing from your own pi setup. */
const PI_ARGS = [
  "--no-extensions",
  "-e",
  path.join(repoRoot, "scripts/fixtures/faux-ext.ts"),
  "--no-skills",
  "--no-context-files",
  "--offline",
  "--provider",
  "faux",
  "--model",
  "faux-1",
];

/** Starting pi runs your login shell first, which can take seconds on CI. */
export const PI_START_TIMEOUT_MS = 30_000;

export interface PiOptions extends LaunchOptions {
  /** A folder for pi's install and the faux script. The test deletes it. */
  workDir: string;
  script: FauxScript;
  /** More arguments for pi, such as `--fork`. */
  piArgs?: string[];
  /** The cli.js to run as pi. The one pnpm installed by default. */
  cli?: string;
}

/** Launches Tondo with the faux pi. Each call needs its own `workDir`. */
export function launchWithPi({
  workDir,
  script,
  piArgs = [],
  cli = PI_CLI,
  settings,
  env,
  ...options
}: PiOptions): Promise<Tondo> {
  const scriptPath = path.join(workDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  return launchTondo({
    ...options,
    settings: { ...settings, piPath: installPi(cli, path.join(workDir, "bin")) },
    env: {
      ...env,
      TONDO_PI_ARGS: JSON.stringify([...PI_ARGS, ...piArgs]),
      TONDO_FAUX_SCRIPT: scriptPath,
    },
  });
}

/** Installs `cli` the way Tondo finds pi: a `pi` command in `bin` with a node beside it. */
function installPi(cli: string, bin: string): string {
  mkdirSync(bin);
  symlinkSync(cli, path.join(bin, "pi"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  return path.join(bin, "pi");
}

/** Makes main's folder dialog pick `folder` from now on, without showing it. */
export function answerFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  return app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, folder);
}

/** Adds `folder` with the sidebar's Add project button. Tondo opens a new thread in it. */
export async function addProject({ app, page }: Tondo, folder: string): Promise<void> {
  await answerFolderDialog(app, folder);
  await page.getByRole("button", { name: "Add project", exact: true }).click();
}

/** Waits until pi has started in the open project and takes prompts. */
export async function waitForPi(page: Page): Promise<void> {
  // The pickers show once pi has reported its model.
  await expect(page.getByLabel("Model")).toBeVisible({ timeout: PI_START_TIMEOUT_MS });
}

/** The composer's text box. Its label, "Message", is also part of "Send message". */
export function composer(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

/** The Markdown source in TipTap's paragraphs, including empty lines and trailing spaces. */
export async function composerText(page: Page): Promise<string | null> {
  const lines = await composer(page).locator("p").allTextContents();
  // An unmounted editor isn't an empty draft.
  return lines.length === 0 ? null : lines.join("\n");
}

export async function expectDraft(page: Page, text: string): Promise<void> {
  await expect.poll(() => composerText(page)).toBe(text);
}

/** The sidebar. */
export function threads(page: Page) {
  return page.getByRole("navigation", { name: "Threads" });
}

/**
 * A thread's row in the sidebar. Its title attribute holds the thread's
 * title. The row's list item also holds a "Thread actions" button, which an
 * aria-label names.
 */
export const THREAD_ROW = "li > button[title]:not([aria-label])";

/** The sidebar's thread rows. */
export function threadRows(page: Page) {
  return threads(page).locator(THREAD_ROW);
}

/** Writes `text` in the composer and presses `key`: Enter sends, or steers while pi works. */
export async function send(page: Page, text: string, key = "Enter"): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press(key);
}

/** Waits until pi's turn has ended. */
export async function waitForIdle(page: Page, options?: { timeout?: number }): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop pi" })).toBeHidden(options);
}

/**
 * Records the text of every status the page shows from now on, such as a
 * banner, once each. It watches the DOM, so it catches ones too brief to poll for.
 */
export function recordStatuses(page: Page) {
  return page.evaluateHandle(() => {
    const seen: string[] = [];
    new MutationObserver(() => {
      for (const status of document.querySelectorAll("[role=status]")) {
        const text = status.textContent ?? "";
        if (!seen.includes(text)) seen.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    return seen;
  });
}

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type ToolCallArguments = Extract<
  AssistantMessage["content"][number],
  { type: "toolCall" }
>["arguments"];

/**
 * A faux model message, as pi-ai's fauxAssistantMessage builds it. Playwright
 * can't load pi-ai at run time, since pi-ai exports nothing to `require`.
 */
function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: { ...NO_TOKENS, totalTokens: 0, cost: { ...NO_TOKENS, total: 0 } },
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.now(),
  };
}

export function reply(text: string): AssistantMessage {
  return assistant([{ type: "text", text }], "stop");
}

/** A reply that calls tools, which pi runs at the same time. Each call's id is `id`. */
export function toolCalls(
  ...calls: { name: string; arguments: ToolCallArguments; id?: string }[]
): AssistantMessage {
  return assistant(
    calls.map((call) => ({
      type: "toolCall",
      id: call.id ?? `call_${randomUUID()}`,
      name: call.name,
      arguments: call.arguments,
    })),
    "toolUse",
  );
}

/** A reply that runs `command` with pi's bash tool. */
export function bashCall(command: string, id?: string): AssistantMessage {
  return toolCalls({ name: "bash", arguments: { command }, ...(id === undefined ? {} : { id }) });
}

/** A model call that fails with `errorMessage`. */
export function failure(errorMessage: string): AssistantMessage {
  return assistant([], "error", errorMessage);
}

/** A bash command that runs until `file` exists, which holds pi's turn open until the test creates it. */
export function waitForFileCommand(file: string): string {
  return `until [ -e '${file}' ]; do sleep 0.05; done`;
}

/**
 * The 20,000-token reply, markdown with code, that `pnpm fixtures` recorded
 * from the faux model into fixtures/stream-1000.jsonl.
 */
export function longReply(): AssistantMessage {
  const fixture = path.join(repoRoot, "fixtures/stream-1000.jsonl");
  const records = readFileSync(fixture, "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        (JSON.parse(line) as { record: { type: string; message?: AssistantMessage } }).record,
    );
  const end = records.findLast(
    (record) => record.type === "message_end" && record.message?.role === "assistant",
  );
  if (!end?.message) throw new Error(`${fixture} has no reply`);
  return assistant(end.message.content, "stop");
}

/** `count` plain words, numbered, so a stretch missing from a reply shows. */
export function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}
