import { describe, expect, it } from "vitest";
import { appendFilePaths } from "./filePaths";

describe("local file references", () => {
  it("keeps cancellation unchanged, including whitespace", () => {
    expect(appendFilePaths("draft  ", [])).toBe("draft  ");
  });

  it("preserves the draft and adds any file type without reading or copying bytes", () => {
    expect(
      appendFilePaths("Compare these", ["/tmp/report.pdf", "/tmp/data.csv", "/tmp/archive.zip"]),
    ).toBe(
      'Compare these\n\nRead these local files:\n- "/tmp/report.pdf"\n- "/tmp/data.csv"\n- "/tmp/archive.zip"',
    );
  });

  it("escapes unusual names as literal data and removes duplicate selections", () => {
    const paths = ['/tmp/spaces and "quotes".txt', "/tmp/line\nbreak", "C:\\files\\data.csv"];
    const result = appendFilePaths("", [...paths, paths[0]!]);
    const listed = result
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line.slice(2)));
    expect(listed).toEqual(paths);
  });
});
