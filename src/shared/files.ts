/** A bounded list of paths relative to the project's folder. No file contents cross the port. */
export interface FileIndex {
  readonly paths: readonly string[];
  readonly truncated: boolean;
  readonly error: string | null;
}

/** A path pi's editor can represent without ambiguous quotes or line breaks. */
export function canMention(path: string): boolean {
  return path !== "" && !/["\\\r\n\0]/.test(path);
}

// pi-tui 0.87.1's autocompleteSeparatorRegex also quotes CJK punctuation.
const CJK =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
const SEPARATOR = new RegExp(
  `(?:\\s|(?=\\p{Punctuation})${CJK.source}|[，．：；！？（）［］｛｝“”‘’…—])`,
  "u",
);

/** The exact literal text pi-tui inserts for a file, before its trailing space. */
export function fileMention(path: string, quoted = false): string {
  return quoted || SEPARATOR.test(path) ? `@"${path}"` : `@${path}`;
}
