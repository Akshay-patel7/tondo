// Helpers for tests on a thread that holds the recorded 1,000-message
// transcript. pi opens it from a session file the test writes.
import { expect, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FauxScript } from "../scripts/fixtures/faux-ext";
import { bringToFront, type Tondo } from "./launch";
import { launchWithPi, openProject, PI_START_TIMEOUT_MS, seedSession } from "./pi";

/**
 * transcript-1000.json holds pi's system prompt and 1,000 messages. The
 * timeline doesn't show the system prompt, so its rows are 0 to 999.
 */
export const TRANSCRIPT_MESSAGES = 1000;
export const LAST_TRANSCRIPT_ROW = TRANSCRIPT_MESSAGES - 1;

/** The follow threshold in src/renderer/timeline/follow.ts. */
export const FOLLOW_THRESHOLD_PX = 40;

export interface TranscriptOptions {
  script: FauxScript;
  /** How many times over the thread holds the transcript's messages. */
  copies?: number;
  /** Gives every JavaScript heap `gc()`, for measureMemory. */
  exposeGc?: boolean;
}

export interface TranscriptTondo extends Tondo {
  /** An empty folder. A thread opened in it starts with the transcript. */
  project: string;
  /** The rows that thread shows. */
  messages: number;
}

/**
 * Launches Tondo in front with the faux pi, which forks a session holding the
 * transcript into each thread it starts. `close` also deletes the session.
 */
export async function launchOnTranscript({
  script,
  copies = 1,
  exposeGc = false,
}: TranscriptOptions): Promise<TranscriptTondo> {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-transcript-")));
  const removeWorkDir = () => rmSync(workDir, { recursive: true, force: true });
  const project = path.join(workDir, "project");
  mkdirSync(project);
  const session = path.join(workDir, "transcript.jsonl");
  seedSession(session, project, copies);

  const tondo = await launchWithPi({
    workDir,
    script,
    piArgs: ["--fork", session],
    exposeGc,
  }).catch((error: unknown) => {
    removeWorkDir();
    throw error;
  });
  const onTranscript: TranscriptTondo = {
    ...tondo,
    project,
    messages: copies * TRANSCRIPT_MESSAGES,
    async close() {
      await tondo.close();
      removeWorkDir();
    },
  };
  await bringToFront(onTranscript).catch(async (error: unknown) => {
    await onTranscript.close();
    throw error;
  });
  return onTranscript;
}

/** Opens the project, and waits until the page shows the thread's last row. */
export async function openTranscript(tondo: TranscriptTondo): Promise<void> {
  await openProject(tondo, tondo.project);
  await waitForTranscript(tondo.page, tondo.messages);
}

/** Waits until the page shows the last row of a thread with `messages` rows. */
export async function waitForTranscript(page: Page, messages = TRANSCRIPT_MESSAGES): Promise<void> {
  await expect(page.locator(`[data-index="${messages - 1}"]`)).toBeAttached({
    timeout: PI_START_TIMEOUT_MS,
  });
}

/** Waits until the reply streaming in is at least `chars` characters long. */
export async function waitForReply(page: Page, chars: number): Promise<void> {
  await page.waitForFunction(
    (length) => (document.querySelector("[data-streaming]")?.textContent?.length ?? 0) >= length,
    chars,
    { polling: 100, timeout: 60_000 },
  );
}

/** Pixels of content below the bottom of the timeline's viewport. */
export function gapToEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Legend List's scroll element is the timeline's only child.
    const scroller = document.querySelector("[data-testid=timeline]")?.firstElementChild;
    if (!scroller) throw new Error("The timeline isn't on the page");
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  });
}
