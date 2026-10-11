import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPiAccounts } from "./accounts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tondo-accounts-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const auth = (content: string) => writeFileSync(path.join(dir, "auth.json"), content);

describe("readPiAccounts", () => {
  it("lists provider ids and types only, sorted, skipping entries of other types", async () => {
    auth(
      JSON.stringify({
        openai: { type: "api_key", key: "sk-SECRET-TOKEN-123" },
        anthropic: {
          type: "oauth",
          access: "SECRET-TOKEN-123",
          refresh: "SECRET-TOKEN-123",
          expires: 1,
        },
        broken: "SECRET-TOKEN-123",
        unknown: { type: "password", value: "SECRET-TOKEN-123" },
        empty: null,
      }),
    );
    const result = await readPiAccounts(dir);
    expect(result).toEqual({
      accounts: [
        { provider: "anthropic", type: "oauth" },
        { provider: "openai", type: "api_key" },
      ],
      error: null,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN-123");
  });

  it("reports no accounts and no error when pi has no auth.json", async () => {
    expect(await readPiAccounts(dir)).toEqual({ accounts: [], error: null });
  });

  it("says malformed JSON is invalid without quoting the file", async () => {
    auth('{"anthropic": {"type": "oauth", "access": "SECRET-TOKEN-123",');
    const result = await readPiAccounts(dir);
    expect(result).toEqual({ accounts: [], error: "pi's auth.json isn't valid JSON." });
    expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN-123");
  });

  it.each(["[]", '"SECRET-TOKEN-123"', "null"])(
    "says a top level of %s has an unexpected shape",
    async (content) => {
      auth(content);
      expect(await readPiAccounts(dir)).toEqual({
        accounts: [],
        error: "pi's auth.json has an unexpected shape.",
      });
    },
  );

  it("names the error code when the file can't be read", async () => {
    mkdirSync(path.join(dir, "auth.json"));
    expect(await readPiAccounts(dir)).toEqual({
      accounts: [],
      error: "Tondo couldn't read pi's auth.json (EISDIR).",
    });
  });
});
