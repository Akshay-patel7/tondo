import { describe, expect, test } from "vitest";
import { editorText, joinDrafts } from "./draft";

describe("joinDrafts", () => {
  test("puts an empty line between texts, in order", () => {
    expect(joinDrafts("Steer this way\n\nThen do that", "and one more thing")).toBe(
      "Steer this way\n\nThen do that\n\nand one more thing",
    );
  });

  test("skips blank texts", () => {
    expect(joinDrafts("Steer this way", "  \n")).toBe("Steer this way");
    expect(joinDrafts("", "a", " ", "b")).toBe("a\n\nb");
    expect(joinDrafts()).toBe("");
  });
});

describe("editorText", () => {
  test("an extension's text replaces a blank composer", () => {
    expect(editorText("", "From the extension", undefined)).toBe("From the extension");
    expect(editorText(" \n", "From the extension", undefined)).toBe("From the extension");
  });

  test("keeps what you typed, with the extension's text after it", () => {
    expect(editorText("my precious draft", "FROM-EXTENSION", undefined)).toBe(
      "my precious draft\n\nFROM-EXTENSION",
    );
    // Clearing the composer doesn't clear your text.
    expect(editorText("my precious draft", "", undefined)).toBe("my precious draft");
  });

  test("replaces the extension's own text until you change it", () => {
    expect(editorText("first", "second", "first")).toBe("second");
    expect(editorText("first, edited", "second", "first")).toBe("first, edited\n\nsecond");
  });
});
