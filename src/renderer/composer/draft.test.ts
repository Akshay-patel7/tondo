import { beforeEach, describe, expect, test } from "vitest";
import { joinDrafts, restoreToDraft, setDraft, useDraft } from "./draft";

describe("restoreToDraft", () => {
  beforeEach(() => setDraft(""));

  test("puts the restored text ahead of the draft, with an empty line between", () => {
    setDraft("and one more thing");
    restoreToDraft("Steer this way\n\nThen do that");
    expect(useDraft.getState()).toBe("Steer this way\n\nThen do that\n\nand one more thing");
  });

  test("adds no empty lines around a blank draft", () => {
    setDraft("  \n");
    restoreToDraft("Steer this way");
    expect(useDraft.getState()).toBe("Steer this way");
  });
});

describe("joinDrafts", () => {
  test("skips blank texts", () => {
    expect(joinDrafts("", "a", " ", "b")).toBe("a\n\nb");
    expect(joinDrafts()).toBe("");
  });
});
