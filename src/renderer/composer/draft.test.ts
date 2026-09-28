import { describe, expect, test } from "vitest";
import { joinDrafts } from "./draft";

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
