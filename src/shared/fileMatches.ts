/** The most paths a file menu lists. */
export const FILE_MATCHES = 20;

/** Filename prefixes first, then matching path substrings. At most FILE_MATCHES rows reach the menu. */
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
    .slice(0, FILE_MATCHES);
}
