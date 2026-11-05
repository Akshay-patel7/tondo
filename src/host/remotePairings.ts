import { createHash, randomBytes } from "node:crypto";
import { open, rename, rm, writeFile } from "node:fs/promises";

const MAX_PAIRINGS = 16;
const MAX_FILE_BYTES = 4096;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Remember devices, not bearer credentials: only token hashes reach disk. */
export class RemotePairings {
  private pending = Promise.resolve();

  private tokens: Set<string>;
  private readonly file: string | undefined;

  private constructor(tokens: Set<string>, file: string | undefined) {
    this.tokens = tokens;
    this.file = file;
  }

  static async open(file?: string): Promise<RemotePairings> {
    if (!file) return new RemotePairings(new Set(), undefined);
    const handle = await open(file, "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!handle) return new RemotePairings(new Set(), file);
    try {
      if ((await handle.stat()).size > MAX_FILE_BYTES)
        throw new Error(
          "The remote pairing file is too large. Turn remote access off to reset it.",
        );
      const data: unknown = JSON.parse(await handle.readFile("utf8"));
      if (
        typeof data !== "object" ||
        data === null ||
        !("version" in data) ||
        data.version !== 1 ||
        !("tokens" in data) ||
        !Array.isArray(data.tokens) ||
        data.tokens.length > MAX_PAIRINGS ||
        !data.tokens.every(
          (token: unknown) => typeof token === "string" && /^[a-f0-9]{64}$/.test(token),
        )
      )
        throw new Error("The remote pairing file is invalid. Turn remote access off to reset it.");
      return new RemotePairings(new Set(data.tokens as string[]), file);
    } finally {
      await handle.close();
    }
  }

  has(token: string): boolean {
    return /^[a-zA-Z0-9_-]{43}$/.test(token) && this.tokens.has(digest(token));
  }

  async remember(token: string): Promise<boolean> {
    let remembered = false;
    const change = this.pending.then(async () => {
      if (this.tokens.size >= MAX_PAIRINGS) return;
      const next = new Set(this.tokens).add(digest(token));
      if (this.file) {
        const temporary = `${this.file}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ version: 1, tokens: [...next] }), {
            mode: 0o600,
            flag: "wx",
          });
          await rename(temporary, this.file);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      this.tokens = next;
      remembered = true;
    });
    this.pending = change.catch(() => {});
    await change;
    return remembered;
  }
}
