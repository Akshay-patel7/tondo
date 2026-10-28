import { describe, expect, it } from "vitest";
import { isProjectScript, isProjectScripts, MAX_PROJECT_SCRIPTS } from "./projectScripts";

const script = { id: "build", name: "Build app", command: "pnpm build" };

describe("project script validation", () => {
  it("accepts shell syntax, quotes, Unicode and multiline commands", () => {
    expect(
      isProjectScript({
        ...script,
        name: "Build 🛠",
        command: "NAME='app build' pnpm build && printf '%s\\n' \"$PWD\"\n\techo done",
      }),
    ).toBe(true);
    expect(isProjectScripts({ "/work/Some project's repo": [script] })).toBe(true);
    expect(isProjectScripts({})).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...script, id: "../build" },
    { ...script, id: "a".repeat(65) },
    { ...script, name: " " },
    { ...script, name: " Build" },
    { ...script, name: "a".repeat(81) },
    { ...script, name: "bad\nname" },
    { ...script, command: " " },
    { ...script, command: "a".repeat(8193) },
    { ...script, command: "bad\0command" },
    { ...script, command: "echo\rnext" },
    { ...script, command: "\x1b[31m" },
    { ...script, cwd: "/tmp" },
  ])("rejects malformed entries: %j", (value) => {
    expect(isProjectScript(value)).toBe(false);
  });

  it.each([
    null,
    [],
    { relative: [script] },
    { "/bad\0folder": [] },
    { "/work": [script, script] },
    { "/work": "build" },
    {
      "/work": Array.from({ length: MAX_PROJECT_SCRIPTS + 1 }, (_, i) => ({
        ...script,
        id: `s-${i}`,
      })),
    },
  ])("rejects malformed project lists: %j", (value) => {
    expect(isProjectScripts(value)).toBe(false);
  });
});
