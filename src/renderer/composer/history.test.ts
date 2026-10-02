import { describe, expect, test } from "vitest";
import type { PiMessage } from "../../shared/thread";
import { promptHistory, stepHistory } from "./history";

const user = (content: Extract<PiMessage, { role: "user" }>["content"]): PiMessage => ({
  role: "user",
  content,
  timestamp: 1,
});
const entries = [
  { index: 0, text: "First" },
  { index: 2, text: "Second\nline" },
];

describe("prompt history", () => {
  test("keeps user text, skips images and blank messages, and collapses consecutive duplicates", () => {
    expect(
      promptHistory([
        user("First"),
        user("First"),
        user(" \n"),
        user([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]),
        user([{ type: "text", text: "Second" }]),
        user("First"),
      ]),
    ).toEqual([
      { index: 1, text: "First" },
      { index: 4, text: "Second" },
      { index: 5, text: "First" },
    ]);
  });

  test("walks backward and forward, then restores the empty draft", () => {
    expect(stepHistory(entries, null, "", "backward")).toEqual({
      position: entries[1],
      text: "Second\nline",
    });
    expect(stepHistory(entries, entries[1]!, "Second\nline", "backward")).toEqual({
      position: entries[0],
      text: "First",
    });
    expect(stepHistory(entries, entries[0]!, "First", "backward")).toBeNull();
    expect(stepHistory(entries, entries[0]!, "First", "forward")).toEqual({
      position: entries[1],
      text: "Second\nline",
    });
    expect(stepHistory(entries, entries[1]!, "Second\nline", "forward")).toEqual({
      position: null,
      text: "",
    });
  });

  test("never overwrites a nonempty draft or an edited recall", () => {
    expect(stepHistory(entries, null, "unsent", "backward")).toBeNull();
    expect(stepHistory(entries, entries[0]!, "First edited", "forward")).toBeNull();
    expect(stepHistory(entries, entries[0]!, "First edited", "backward")).toBeNull();
    expect(stepHistory([], null, "", "backward")).toBeNull();
    expect(stepHistory(entries, null, "", "forward")).toBeNull();
  });
});
