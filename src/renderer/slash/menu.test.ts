import { describe, expect, it } from "vitest";
import type { SlashCommand } from "../../shared/protocol";
import { searchSlash, slashItems, slashQuery } from "./menu";

const COMMANDS: SlashCommand[] = [
  { name: "tondo-ui", description: "Calls every extension UI method", source: "extension" },
  // pi's hidden llama.cpp extension registers /llama, which is also a built-in.
  { name: "llama", description: "Manage llama.cpp router models", source: "extension" },
  { name: "review", description: "Review staged changes", source: "prompt" },
  { name: "skill:pdf-tools", description: "Extract text from PDFs", source: "skill" },
];

const names = (query: string) => searchSlash(slashItems(COMMANDS), query).map((item) => item.name);

describe("slashItems", () => {
  it("lists Tondo's built-ins, then pi's commands, then what Tondo can't run", () => {
    const items = slashItems(COMMANDS);
    const sources: string[] = items.map((item) => (item.unavailable ? "unavailable" : item.source));
    const first = (source: string) => sources.indexOf(source);
    expect(first("tondo")).toBe(0);
    expect(first("extension")).toBeGreaterThan(sources.lastIndexOf("tondo"));
    expect(first("unavailable")).toBeGreaterThan(first("skill"));
    expect(sources.slice(first("unavailable")).every((source) => source === "unavailable")).toBe(
      true,
    );
  });

  it("leaves out pi's commands named like a built-in, as pi's menu does", () => {
    const llamas = slashItems(COMMANDS).filter((item) => item.name === "llama");
    expect(llamas).toEqual([
      expect.objectContaining({ source: "tondo", unavailable: expect.any(String) }),
    ]);
  });
});

describe("searchSlash", () => {
  it("lists everything for an empty query", () => {
    expect(names("")).toEqual(slashItems(COMMANDS).map((item) => item.name));
  });

  it("puts an exact name first, then names that start with the query, shorter first", () => {
    expect(names("compact")[0]).toBe("compact");
    expect(names("co").slice(0, 2)).toEqual(["copy", "compact"]);
    expect(names("re").slice(0, 3)).toEqual(["resume", "reload", "review"]);
  });

  it("finds skills by the name after skill:, and all of them by skill", () => {
    expect(names("pdf")[0]).toBe("skill:pdf-tools");
    expect(names("skill")[0]).toBe("skill:pdf-tools");
  });

  it("matches letters in order, and descriptions after names", () => {
    expect(names("tui")).toEqual(["tondo-ui"]);
    expect(names("staged")).toEqual(["review"]);
  });

  it("puts what Tondo can't run after everything it can", () => {
    expect(names("log")).toEqual(["login", "logout", "changelog"]);
    const found = searchSlash(slashItems(COMMANDS), "l").map(
      (item) => item.unavailable !== undefined,
    );
    expect(found).toContain(true);
    expect(found).toEqual(found.toSorted((a, b) => Number(a) - Number(b)));
  });

  it("finds nothing for text that matches nothing", () => {
    expect(names("zzz")).toEqual([]);
  });
});

describe("slashQuery", () => {
  it("is the command's name while you type it at the start of a message", () => {
    expect(slashQuery("/", 1)).toBe("");
    expect(slashQuery("/comp", 5)).toBe("comp");
    expect(slashQuery("/skill:pdf", 10)).toBe("skill:pdf");
  });

  it("is null anywhere else", () => {
    expect(slashQuery("", 0)).toBeNull();
    expect(slashQuery("compact", 7)).toBeNull();
    expect(slashQuery("/compact now", 12)).toBeNull();
    expect(slashQuery("hi /compact", 11)).toBeNull();
    expect(slashQuery("line\n/compact", 13)).toBeNull();
    // Completing inside the name would leave \"pact\" behind.
    expect(slashQuery("/compact", 4)).toBeNull();
    // Right after the name, before a space, it still completes.
    expect(slashQuery("/comp now", 5)).toBe("comp");
  });
});
