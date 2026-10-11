import { describe, expect, it } from "vitest";
import { editorText, joinDrafts } from "./drafts";

describe("joinDrafts", () => {
  it("keeps the texts that aren't blank, an empty line apart", () => {
    expect(joinDrafts("typed", " \n", "restored")).toBe("typed\n\nrestored");
    expect(joinDrafts()).toBe("");
  });
});

describe("editorText", () => {
  it("puts an extension's text after a draft you typed, as the host does for a hidden thread", () => {
    expect(editorText("my precious draft", "FROM-EXTENSION", undefined)).toBe(
      "my precious draft\n\nFROM-EXTENSION",
    );
  });

  it("replaces a blank draft, or the extension's own unchanged text", () => {
    expect(editorText("", "FROM-EXTENSION", undefined)).toBe("FROM-EXTENSION");
    expect(editorText("first", "second", "first")).toBe("second");
  });

  it("replaces only the extension's text after a draft you typed, on every later call", () => {
    expect(editorText("typed\n\nfirst", "second", "first")).toBe("typed\n\nsecond");
    expect(editorText("typed, edited\n\nfirst!", "second", "first")).toBe(
      "typed, edited\n\nfirst!\n\nsecond",
    );
  });
});
