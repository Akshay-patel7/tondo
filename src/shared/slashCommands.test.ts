import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  builtinIn,
  canRun,
  findModel,
  isBuiltin,
  parseSlash,
  pathArgument,
} from "./slashCommands";

const pi = path.resolve(import.meta.dirname, "../../node_modules/@earendil-works/pi-coding-agent");

describe("pi's built-in slash commands", () => {
  it("maps every command pi's slash-commands.md lists", () => {
    const doc = readFileSync(path.join(pi, "docs/slash-commands.md"), "utf8");
    // Table rows name a command first: | `/compact [instructions]` | ... |
    const names = [...doc.matchAll(/^\| `\/([\w-]+)/gm)].map((match) => match[1]!);
    // A change to the page's format mustn't make this pass by finding nothing.
    expect(names.length).toBeGreaterThanOrEqual(25);
    expect(names.filter((name) => !isBuiltin(name))).toEqual([]);
  });

  it("maps every command pi's terminal UI runs as built in", async () => {
    // pi doesn't export the list, so the test loads pi's own module for it.
    const file = pathToFileURL(path.join(pi, "dist/core/slash-commands.js")).href;
    const { BUILTIN_SLASH_COMMANDS } = (await import(file)) as {
      BUILTIN_SLASH_COMMANDS: readonly { name: string }[];
    };
    const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);
    expect(names.length).toBeGreaterThanOrEqual(24);
    expect(names.filter((name) => !isBuiltin(name))).toEqual([]);
  });

  it("runs each one, or says why it can't", () => {
    for (const [name, command] of Object.entries(BUILTIN_COMMANDS)) {
      expect(command.description, name).not.toBe("");
      if (!isBuiltin(name)) throw new Error(`${name} isn't a built-in`);
      if (canRun(name)) expect(command.unavailable, name).toBeUndefined();
      else expect(command.unavailable, name).toMatch(/\.$/);
    }
  });
});

describe("parseSlash", () => {
  it("splits a command from its arguments", () => {
    expect(parseSlash("/compact")).toEqual({ name: "compact", args: "" });
    expect(parseSlash("  /compact keep the plan \n")).toEqual({
      name: "compact",
      args: "keep the plan",
    });
    expect(parseSlash("/name  Parser fix")).toEqual({ name: "name", args: "Parser fix" });
    expect(parseSlash("/skill:review src\nand tests")).toEqual({
      name: "skill:review",
      args: "src\nand tests",
    });
  });

  it("finds no command in other text", () => {
    expect(parseSlash("")).toBeNull();
    expect(parseSlash("/")).toBeNull();
    expect(parseSlash("/ compact")).toBeNull();
    expect(parseSlash("what does /compact do?")).toBeNull();
  });
});

describe("builtinIn", () => {
  it("finds pi's built-ins by name, with or without arguments", () => {
    expect(builtinIn("/session")).toEqual({ name: "session", args: "" });
    expect(builtinIn("/model faux/faux-2")).toEqual({ name: "model", args: "faux/faux-2" });
    expect(builtinIn("/copy please")).toEqual({ name: "copy", args: "please" });
  });

  it("leaves extension commands, prompt templates and skills to pi", () => {
    expect(builtinIn("/review")).toBeNull();
    expect(builtinIn("/skill:review")).toBeNull();
    // pi names a second command called session "session:2".
    expect(builtinIn("/session:2")).toBeNull();
    // Names come from untrusted text, and Object's own keys aren't commands.
    expect(builtinIn("/constructor")).toBeNull();
    expect(builtinIn("/__proto__")).toBeNull();
  });
});

describe("pathArgument", () => {
  it("reads a path the way pi's /export does", () => {
    expect(pathArgument("")).toBe("");
    expect(pathArgument("thread.html")).toBe("thread.html");
    expect(pathArgument("  out/thread.html and more")).toBe("out/thread.html");
    expect(pathArgument('"my thread.html" more')).toBe("my thread.html");
    expect(pathArgument("'my thread.html'")).toBe("my thread.html");
    // pi gives up on a quote that isn't closed and names the file itself.
    expect(pathArgument('"my thread.html')).toBe("");
  });
});

describe("findModel", () => {
  const models = [
    { provider: "anthropic", id: "claude-opus-4-5" },
    { provider: "openrouter", id: "claude-opus-4-5" },
    { provider: "faux", id: "faux-2" },
  ];

  it("finds a model by provider/id or by an id only one provider has, ignoring case", () => {
    expect(findModel("anthropic/claude-opus-4-5", models)).toBe(models[0]);
    expect(findModel(" Faux/FAUX-2 ", models)).toBe(models[2]);
    expect(findModel("faux / faux-2", models)).toBe(models[2]);
    expect(findModel("faux-2", models)).toBe(models[2]);
  });

  it("finds none when the reference fits no model, or more than one", () => {
    expect(findModel("claude-opus-4-5", models)).toBeUndefined();
    expect(findModel("gpt-5", models)).toBeUndefined();
    expect(findModel("", models)).toBeUndefined();
  });
});
