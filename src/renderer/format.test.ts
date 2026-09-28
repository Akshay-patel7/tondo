import { describe, expect, test } from "vitest";
import { folderName, formatPercent, formatTokens } from "./format";

describe("folderName", () => {
  test("takes the last part of a path", () => {
    expect(folderName("/Users/me/code/tondo")).toBe("tondo");
    expect(folderName("/Users/me/code/tondo/")).toBe("tondo");
    expect(folderName(String.raw`C:\code\tondo`)).toBe("tondo");
    expect(folderName("/")).toBe("/");
  });
});

describe("formatTokens", () => {
  test("shortens counts to a few characters", () => {
    expect(formatTokens(950.4)).toBe("950");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(1_250)).toBe("1.3k");
    expect(formatTokens(45_400)).toBe("45k");
    expect(formatTokens(1_000_000)).toBe("1m");
    expect(formatTokens(1_540_000)).toBe("1.5m");
  });
});

describe("formatPercent", () => {
  test("keeps one decimal below 10%", () => {
    expect(formatPercent(0.44)).toBe("0.4%");
    expect(formatPercent(9)).toBe("9%");
    expect(formatPercent(9.46)).toBe("9.5%");
    expect(formatPercent(12.6)).toBe("13%");
  });
});
