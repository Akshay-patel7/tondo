import { describe, expect, test } from "vitest";
import { folderName, formatAge, formatPercent, formatTokens } from "./format";

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

describe("formatAge", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  const ago = (ms: number) => formatAge(now - ms, now);
  const minute = 60_000;
  const day = 24 * 60 * minute;

  test("counts the largest whole unit", () => {
    expect(ago(59_999)).toBe("now");
    expect(ago(minute)).toBe("1m");
    expect(ago(59 * minute)).toBe("59m");
    expect(ago(60 * minute)).toBe("1h");
    expect(ago(day - 1)).toBe("23h");
    expect(ago(day)).toBe("1d");
    expect(ago(6 * day)).toBe("6d");
    expect(ago(7 * day)).toBe("1w");
    expect(ago(29 * day)).toBe("4w");
    expect(ago(30 * day)).toBe("1mo");
    expect(ago(364 * day)).toBe("12mo");
    expect(ago(365 * day)).toBe("1y");
  });

  test("calls a time from a clock that runs ahead now", () => {
    expect(formatAge(now + 5 * minute, now)).toBe("now");
  });
});
