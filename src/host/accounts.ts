// Lists the sign-ins pi saved in <agent dir>/auth.json. The file holds live
// tokens and keys, so nothing but provider ids and types leaves this module:
// not the file's text, not a field, and not V8's JSON errors, which quote it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PiAccount } from "../shared/protocol";

export interface PiAccounts {
  readonly accounts: readonly PiAccount[];
  /** Why the file couldn't be read. A missing file isn't an error: you haven't signed in. */
  readonly error: string | null;
}

export async function readPiAccounts(agentDir: string): Promise<PiAccounts> {
  let text: string;
  try {
    text = await readFile(path.join(agentDir, "auth.json"), "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown error";
    if (code === "ENOENT") return { accounts: [], error: null };
    return { accounts: [], error: `Tondo couldn't read pi's auth.json (${code}).` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  } catch {
    return { accounts: [], error: "pi's auth.json isn't valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { accounts: [], error: "pi's auth.json has an unexpected shape." };
  const accounts: PiAccount[] = [];
  for (const [provider, entry] of Object.entries(parsed)) {
    if (typeof entry !== "object" || entry === null) continue;
    const type: unknown = (entry as { type?: unknown }).type;
    if (type === "oauth" || type === "api_key") accounts.push({ provider, type });
  }
  accounts.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return { accounts, error: null };
}
