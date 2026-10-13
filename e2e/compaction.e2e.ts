// Real offline pi compaction, including the smaller context it resumes from.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bringToFront, launchTondo, type Tondo } from "./launch";
import {
  addProject,
  composer,
  expectDraft,
  launchWithPi,
  reply,
  send,
  threadRows,
  waitForIdle,
  waitForPi,
} from "./pi";
import { sessionFolder } from "./sessions";

let dir: string;
let tondo: Tondo | undefined;

test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-compaction-e2e-")));
});

test.afterEach(async () => {
  await tondo?.close();
  tondo = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function seed(folder: string, project: string): string {
  mkdirSync(folder, { recursive: true });
  const id = randomUUID();
  const time = Date.now() - 60_000;
  const messages = [
    { role: "user", content: "Original thread request", timestamp: time },
    { ...reply("Earlier context. ".repeat(5_000)), timestamp: time + 1 },
    { role: "user", content: "Later thread request", timestamp: time + 2 },
    { ...reply("Recent context. ".repeat(5_000)), timestamp: time + 3 },
    { role: "user", content: "Recent short request", timestamp: time + 4 },
    { ...reply("Short recent context. ".repeat(100)), timestamp: time + 5 },
    { role: "user", content: "Current retained request", timestamp: time + 6 },
    { ...reply("Small final reply."), timestamp: time + 7 },
  ];
  const messageEntries = messages.map((message, index) => ({
    type: "message",
    id: index.toString(16).padStart(8, "0"),
    parentId: index === 0 ? null : (index - 1).toString(16).padStart(8, "0"),
    timestamp: new Date(message.timestamp).toISOString(),
    message,
  }));
  const file = path.join(folder, `${id}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        cwd: project,
        timestamp: new Date(time).toISOString(),
      }),
      ...messageEntries.map((entry) => JSON.stringify(entry)),
      "",
    ].join("\n"),
  );
  return file;
}

function entries(file: string): {
  type: string;
  id?: string;
  firstKeptEntryId?: string;
  message?: { role: string; content: unknown };
}[] {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

for (const reason of ["manual", "automatic"] as const) {
  for (const named of [false, true]) {
    test(`${reason} compaction keeps the ${named ? "custom" : "original"} thread title after reload and cold restart`, async () => {
      test.setTimeout(90_000);
      const project = path.join(dir, "Tondo");
      const profileDir = path.join(dir, "profile");
      // Packaged tests' pi wrapper uses workDir; unpackaged Tondo uses its profile.
      const agentDir = path.join(process.env.TONDO_E2E_EXECUTABLE ? dir : profileDir, "pi-agent");
      mkdirSync(project);
      mkdirSync(profileDir);
      mkdirSync(agentDir, { recursive: true });
      // The automatic threshold is 10,000 tokens in Faux 1's 100M context.
      // Keep little enough history that the original prompt leaves pi's context.
      writeFileSync(
        path.join(agentDir, "settings.json"),
        JSON.stringify({
          compaction: {
            enabled: reason === "automatic",
            reserveTokens: 99_990_000,
            keepRecentTokens: 128,
          },
        }),
      );
      const file = seed(sessionFolder(path.dirname(agentDir), project), project);
      tondo = await launchWithPi({
        workDir: dir,
        profileDir,
        env: { PI_CODING_AGENT_DIR: agentDir },
        script: {
          // pi summarizes the history and the cut turn separately before continuing.
          responses: [
            reply("Compacted context summary."),
            reply("Compacted turn prefix."),
            reply("Continued after compaction."),
          ],
        },
      });
      await bringToFront(tondo);
      let { page } = tondo;
      const errors: string[] = [];
      const watch = () => {
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
      };
      watch();
      await addProject(tondo, project);
      await threadRows(page).filter({ hasText: "Original thread request" }).click();
      await expect(
        page.getByRole("heading", { name: "Original thread request", exact: true }),
      ).toBeVisible();
      await waitForPi(page);
      const title = named ? "My custom thread name" : "Original thread request";
      if (named) {
        await send(page, `/name ${title}`);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      }
      await send(page, reason === "manual" ? "/compact" : "Continue this thread");
      await expect
        .poll(() => entries(file).filter((entry) => entry.type === "compaction").length)
        .toBe(1);
      // Prove this is a real compaction that dropped the first user entry.
      const records = entries(file);
      const compacted = records.find((entry) => entry.type === "compaction")!;
      expect(compacted.firstKeptEntryId).not.toBe("00000000");
      const keptAt = records.findIndex((entry) => entry.id === compacted.firstKeptEntryId);
      expect(keptAt).toBeGreaterThan(0);
      const firstKeptUser = records.slice(keptAt).find((entry) => entry.message?.role === "user");
      const firstKeptPrompt = firstKeptUser?.message?.content;
      if (typeof firstKeptPrompt !== "string") throw new Error("The fixture kept no user prompt.");
      expect(firstKeptPrompt).not.toBe("Original thread request");
      if (reason === "automatic") {
        await expect(page.getByText("Continued after compaction.", { exact: true })).toBeVisible();
      }
      await waitForIdle(page);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await send(page, "/reload");
      const transcript = page.getByRole("region", { name: "Transcript", exact: true });
      await transcript.focus();
      await transcript.press("Home");
      // The history is virtualized. Read its beginning rather than treating an
      // offscreen original prompt as proof that pi loaded the compacted context.
      await expect(page.getByRole("article", { name: "You", exact: true }).first()).toHaveText(
        firstKeptPrompt,
      );
      await waitForPi(page);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(threadRows(page).filter({ hasText: title })).toHaveCount(1);
      await transcript.press("End");
      await composer(page).fill("Draft kept after compaction");
      await page.screenshot({
        path: test.info().outputPath("compacted-title.png"),
        animations: "disabled",
      });
      await tondo.close();
      tondo = await launchTondo({ profileDir, env: { PI_CODING_AGENT_DIR: agentDir } });
      ({ page } = tondo);
      watch();
      await waitForPi(page);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(threadRows(page).filter({ hasText: title })).toHaveCount(1);
      await expectDraft(page, "Draft kept after compaction");
      expect(errors).toEqual([]);
    });
  }
}
