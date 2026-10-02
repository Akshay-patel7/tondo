import { fileMention } from "../../shared/files";

export interface FileQuery {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly quoted: boolean;
}

/** A standalone @ token before the caret, including a path in unfinished double quotes. */
export function fileQuery(text: string, caret: number): FileQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s='"])(@(?:"[^"\r\n]*|[^\s@"'=]*))$/u.exec(before);
  if (!match) return null;
  const token = match[1]!;
  const quoted = token.startsWith('@"');
  return { from: caret - token.length, to: caret, query: token.slice(quoted ? 2 : 1), quoted };
}

/** pi's completion keeps a path literal, removes an existing closing quote and adds a space. */
export function completeFile(
  text: string,
  query: FileQuery,
  path: string,
): { text: string; caret: number } {
  const value = `${fileMention(path, query.quoted)} `;
  const end = query.to + (query.quoted && text[query.to] === '"' ? 1 : 0);
  return {
    text: text.slice(0, query.from) + value + text.slice(end),
    caret: query.from + value.length,
  };
}

/** Filename prefixes first, then matching path substrings. At most 20 rows reach the menu. */
export function matchingFiles(paths: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  const starts = (path: string) =>
    path
      .slice(path.lastIndexOf("/") + 1)
      .toLowerCase()
      .startsWith(needle);
  return paths
    .filter((path) => path.toLowerCase().includes(needle))
    .toSorted((a, b) => {
      return Number(starts(b)) - Number(starts(a)) || a.length - b.length || a.localeCompare(b);
    })
    .slice(0, 20);
}
