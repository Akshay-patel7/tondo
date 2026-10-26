import { describe, expect, test } from "vitest";
import type { AssistantMessage, PiMessage } from "../../shared/thread";
import { navigationIndex, navigationPreview, navigationTargets } from "./navigation";
import { timelineRows } from "./turns";

const user = (content: Extract<PiMessage, { role: "user" }>["content"]): PiMessage => ({
  role: "user",
  content,
  timestamp: 0,
});
const assistant = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "faux",
  provider: "faux",
  model: "faux-1",
  timestamp: 0,
  stopReason: "stop",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

describe("navigationTargets", () => {
  test("indexes user rows, with final replies from their whole turn", () => {
    const messages = [
      user("First"),
      assistant("Working"),
      assistant("Done"),
      user("Second"),
      user("Third"),
    ];
    const targets = navigationTargets(timelineRows(messages));
    expect(targets.map(({ index }) => index)).toEqual([0, 3, 4]);
    expect(targets[0]?.prompt).toBe(messages[0]);
    expect(targets[0]?.replies[1]).toBe(messages[2]);
    expect(navigationPreview(targets[0]!)).toEqual({ prompt: "First", reply: "Done" });
    expect(navigationPreview(targets[1]!).reply).toBe("No reply preview");
  });

  test("empty or assistant-only history has no targets", () => {
    expect(navigationTargets([])).toEqual([]);
    expect(navigationTargets(timelineRows([assistant("Hello")]))).toEqual([]);
  });
});

describe("navigationPreview", () => {
  test("normalizes only a bounded prefix of huge text", () => {
    const content = "Hello\n world ".repeat(1_000_000);
    const target = {
      index: 0,
      prompt: user(content) as Extract<PiMessage, { role: "user" }>,
      replies: [assistant(content)],
    };
    const preview = navigationPreview(target);
    expect(preview.prompt).toMatch(/^Hello world Hello world/);
    expect(preview.prompt.length).toBeLessThanOrEqual(320);
    expect(preview.reply.length).toBeLessThanOrEqual(320);
    expect(preview.reply).not.toContain("\n");
  });

  test("handles image-only messages and mixed text/image content", () => {
    const image = { type: "image" as const, data: "ignored", mimeType: "image/png" };
    const target = {
      index: 0,
      prompt: { role: "user" as const, timestamp: 0, content: [image] },
      replies: [],
    };
    expect(navigationPreview(target).prompt).toBe("Image or attachment");
    expect(
      navigationPreview({
        ...target,
        prompt: { ...target.prompt, content: [image, { type: "text", text: "Look\n here" }] },
      }).prompt,
    ).toBe("Look here");
  });

  test("multiple text blocks share the character limit, separators included", () => {
    const target = navigationTargets(
      timelineRows([
        user([
          { type: "text", text: "a".repeat(319) },
          { type: "text", text: "overflow" },
        ]),
      ]),
    )[0]!;
    expect(navigationPreview(target).prompt.length).toBeLessThanOrEqual(320);
  });

  test("bounds scans through blocks and tool-only replies", () => {
    const hidden = assistant("Hidden text");
    const thinking: AssistantMessage = {
      ...hidden,
      content: [{ type: "thinking", thinking: "private" }],
    };
    const target = {
      index: 0,
      prompt: { role: "user" as const, timestamp: 0, content: "Go" },
      replies: [hidden, ...Array.from({ length: 32 }, () => thinking)],
    };
    expect(navigationPreview(target).reply).toBe("No reply preview");
    const blocks: AssistantMessage = {
      ...hidden,
      content: [
        ...Array.from({ length: 32 }, () => thinking.content[0]!),
        { type: "text", text: "Hidden text" },
      ],
    };
    expect(navigationPreview({ ...target, replies: [blocks] }).reply).toBe("No reply preview");
  });
});

test("pointer positions reach every prompt even when the drawn ticks are capped", () => {
  expect(navigationIndex(-1, 5000)).toBe(0);
  expect(navigationIndex(2, 5000)).toBe(4999);
  expect(navigationIndex(0.5, 0)).toBe(0);
  expect(navigationIndex(0.5, 1)).toBe(0);
  for (let index = 0; index < 5000; index++) {
    expect(navigationIndex(index / 4999, 5000)).toBe(index);
  }
});
