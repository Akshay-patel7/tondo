import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_PAGE_BYTES, HISTORY_PAGE_MESSAGES } from "../shared/history";
import { SessionHistory } from "./history";

let dir: string;
let file: string;
const time = "2026-10-26T00:00:00.000Z";
type Entry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
};
function message(id: string, parentId: string | null, role: string, content: unknown): Entry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: time,
    message: { role, content, timestamp: 1 },
  };
}
const user = (id: string, parentId: string | null, text = id) =>
  message(id, parentId, "user", text);
const assistant = (id: string, parentId: string, text = id) =>
  message(id, parentId, "assistant", [{ type: "text", text }]);
const compact = (id: string, parentId: string, firstKeptEntryId: string): Entry => ({
  type: "compaction",
  id,
  parentId,
  timestamp: time,
  summary: "Summary",
  firstKeptEntryId,
  tokensBefore: 1000,
});
async function seed(entries: Entry[]): Promise<void> {
  await writeFile(
    file,
    [
      JSON.stringify({ type: "session", version: 3, id: "session", timestamp: time }),
      ...entries.map((entry) => JSON.stringify(entry)),
      "",
    ].join("\n"),
  );
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tondo-history-"));
  file = path.join(dir, "session.jsonl");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("saved history", () => {
  it("indexes summarized prompts even when only one prompt remains in model context", async () => {
    await seed([
      user("u0", null, "Old request"),
      assistant("a0", "u0", "Old answer"),
      user("u1", "a0", "Current request"),
      assistant("a1", "u1"),
      compact("c", "a1", "u1"),
    ]);
    const before = await readFile(file, "utf8");
    const history = await SessionHistory.read(file, "session");
    expect(history.index.prompts).toEqual(["u0"]);
    expect(await history.preview("u0")).toEqual({ prompt: "Old request", reply: "Old answer" });
    const page = await history.page("u0");
    expect(page.messages.map((value) => value.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(JSON.stringify(history.index)).not.toContain("Old request");
  });

  it("follows the selected branch and latest compaction, not abandoned prompts", async () => {
    await seed([
      user("root", null),
      assistant("a", "root"),
      user("abandoned", "a"),
      compact("wrong", "abandoned", "root"),
      user("kept", "a"),
      assistant("b", "kept"),
      compact("c", "b", "kept"),
      user("tail", "c"),
      compact("c2", "tail", "tail"),
    ]);
    const history = await SessionHistory.read(file, "session");
    expect(history.prompts).toEqual(["root", "kept"]);
    expect(
      (await history.page("root")).messages.some(
        (value) => value.role === "user" && value.content === "abandoned",
      ),
    ).toBe(false);
    await expect(history.page("abandoned")).rejects.toThrow("no longer");
  });

  it("does not mistake nested extension data for a user prompt", async () => {
    await seed([
      user("old", null),
      {
        type: "custom",
        id: "extension",
        parentId: "old",
        timestamp: time,
        data: { message: { role: "user", content: "Not a prompt" } },
      },
      user("live", "extension"),
      compact("c", "live", "live"),
    ]);
    expect((await SessionHistory.read(file, "session")).prompts).toEqual(["old"]);
  });

  it("indexes a prompt whose assistant turn was cut by compaction", async () => {
    await seed([
      user("old", null),
      assistant("part1", "old"),
      assistant("part2", "part1"),
      compact("c", "part2", "part2"),
    ]);
    const history = await SessionHistory.read(file, "session");
    expect(history.prompts).toEqual(["old"]);
    expect((await history.preview("old")).reply).toBe("part2");
  });

  it("does not parse or retain large tool bodies while indexing", async () => {
    const big = "huge tool output ".repeat(200_000);
    await seed([
      user("old", null, "Привет 🌍"),
      message("tool", "old", "toolResult", [{ type: "text", text: big }]),
      user("current", "tool"),
      compact("c", "current", "current"),
    ]);
    const lengths: number[] = [];
    const parse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
      lengths.push(text.length);
      return parse(text, reviver);
    });
    const history = await SessionHistory.read(file, "session");
    expect(Math.max(...lengths)).toBeLessThan(4096);
    expect(history.prompts).toEqual(["old"]);
    const page = await history.page("old");
    expect(page.messages[0]).toMatchObject({ content: "Привет 🌍" });
    expect(page.messages[1]).toMatchObject({ role: "custom", customType: "history-limit" });
    expect(JSON.stringify(page)).not.toContain(big);
  });

  it("pages large turns with hard byte/message budgets and usable continuation cursors", async () => {
    const entries: Entry[] = [user("old", null)];
    for (let i = 0; i < 150; i++)
      entries.push(assistant(`a${i}`, entries.at(-1)!.id, "x".repeat(20_000)));
    entries.push(user("current", entries.at(-1)!.id), compact("c", "current", "current"));
    await seed(entries);
    const history = await SessionHistory.read(file, "session");
    let cursor: string | null = "old";
    const seen: unknown[] = [];
    while (cursor) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- prove continuation visits every page in order.
      const page = await history.page(cursor);
      expect(page.messages.length).toBeLessThanOrEqual(HISTORY_PAGE_MESSAGES);
      expect(JSON.stringify(page).length).toBeLessThan(HISTORY_PAGE_BYTES);
      seen.push(...page.messages);
      cursor = page.next;
    }
    expect(seen).toHaveLength(152);
    const previous = (await history.page("a100")).previous;
    expect(previous).not.toBeNull();
    // The previous section must also respect bytes. Jumping back a fixed 64
    // records would skip the tail of the immediately preceding section.
    expect(Number(previous!.slice(1))).toBeGreaterThan(100 - HISTORY_PAGE_MESSAGES);
  });

  it("bounds preview text and reads, choosing the last textual response", async () => {
    await seed([
      user("u", null, "Hello \n world ".repeat(10_000)),
      assistant("a", "u", "A \n B ".repeat(10_000)),
      user("live", "a"),
      compact("c", "live", "live"),
    ]);
    const preview = await (await SessionHistory.read(file, "session")).preview("u");
    expect(preview.prompt).toMatch(/^Hello world/);
    expect(preview.reply).toMatch(/^A B/);
    expect(preview.prompt.length).toBeLessThanOrEqual(320);
    expect(preview.reply.length).toBeLessThanOrEqual(320);
  });

  it("rejects replaced files and stale entry offsets", async () => {
    await seed([user("u", null), user("live", "u"), compact("c", "live", "live")]);
    const history = await SessionHistory.read(file, "session");
    await seed([user("different", null)]);
    await expect(history.page("u")).rejects.toThrow("changed");
    await writeFile(file, `${JSON.stringify({ type: "session", id: "other" })}\n`);
    await expect(history.page("u")).rejects.toThrow("identity");
  });

  it("rejects cyclic ancestry, wrong sessions and cancelled scans", async () => {
    await seed([user("u", "v"), user("v", "u")]);
    await expect(SessionHistory.read(file, "session")).rejects.toThrow("cyclic");
    await expect(SessionHistory.read(file, "wrong")).rejects.toThrow("belongs");
    const controller = new AbortController();
    controller.abort();
    await expect(SessionHistory.read(file, "session", controller.signal)).rejects.toThrow();
  });

  it("keeps custom messages, direct shell output and valid tool results", async () => {
    await seed([
      user("u", null),
      {
        type: "custom_message",
        id: "custom",
        parentId: "u",
        timestamp: time,
        customType: "Note",
        display: true,
        content: "Saved note",
      },
      {
        ...message("shell", "custom", "bashExecution", []),
        message: {
          role: "bashExecution",
          command: "pwd",
          output: "here",
          exitCode: 0,
          timestamp: 1,
        },
      },
      {
        ...message("tool", "shell", "toolResult", [{ type: "text", text: "result" }]),
        message: {
          role: "toolResult",
          toolCallId: "call",
          toolName: "bash",
          content: [{ type: "text", text: "result" }],
          isError: false,
          timestamp: 1,
        },
      },
      user("live", "tool"),
      compact("c", "live", "live"),
    ]);
    const page = await (await SessionHistory.read(file, "session")).page("u");
    expect(page.messages.map((value) => value.role)).toEqual([
      "user",
      "custom",
      "bashExecution",
      "toolResult",
      "user",
    ]);
  });
});
