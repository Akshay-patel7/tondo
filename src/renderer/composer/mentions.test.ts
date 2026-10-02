import { describe, expect, test } from "vitest";
import { canMention, fileMention } from "../../shared/files";
import { completeFile, fileQuery, matchingFiles } from "./mentions";

describe("file mentions", () => {
  test("matches pi's literal and quoted file completions", () => {
    expect(fileMention("src/main.ts")).toBe("@src/main.ts");
    expect(fileMention("space name.txt")).toBe('@"space name.txt"');
    expect(fileMention("plain.txt", true)).toBe('@"plain.txt"');
    expect(canMention('ambiguous"name')).toBe(false);
  });

  test("finds standalone and quoted tokens, not email addresses or a completed mention", () => {
    expect(fileQuery("Read @src/ma", 12)).toEqual({
      from: 5,
      to: 12,
      query: "src/ma",
      quoted: false,
    });
    expect(fileQuery('Read @"space na', 15)).toEqual({
      from: 5,
      to: 15,
      query: "space na",
      quoted: true,
    });
    expect(fileQuery("email@example.com", 17)).toBeNull();
    expect(fileQuery("@done ", 6)).toBeNull();
    expect(fileQuery('@"done"', 7)).toBeNull();
    expect(fileQuery("line\n@", 6)?.from).toBe(5);
  });

  test("replaces only the token at the caret and handles an existing closing quote", () => {
    const source = 'Read @"sp" next';
    expect(completeFile(source, fileQuery(source, 9)!, "space name.txt")).toEqual({
      text: 'Read @"space name.txt"  next',
      caret: 23,
    });
    const prefix = "first\n@pla";
    expect(completeFile(prefix, fileQuery(prefix, prefix.length)!, "plain.txt")).toEqual({
      text: "first\n@plain.txt ",
      caret: 17,
    });
  });

  test("ranks filename prefixes first, filters without case and caps results", () => {
    expect(matchingFiles(["a/test.ts", "tests/a.ts", "test.ts", "other"], "TEST")).toEqual([
      "test.ts",
      "a/test.ts",
      "tests/a.ts",
    ]);
    expect(
      matchingFiles(
        Array.from({ length: 30 }, (_, i) => `${i}.txt`),
        "",
      ),
    ).toHaveLength(20);
  });
});
