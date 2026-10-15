import { joinDrafts } from "../../shared/drafts";

/** Quote paths as data, not shell commands. Escaping keeps unusual filenames on one line. */
export function appendFilePaths(draft: string, paths: readonly string[]): string {
  if (paths.length === 0) return draft;
  const references = [...new Set(paths)].map((path) => `- ${JSON.stringify(path)}`).join("\n");
  return joinDrafts(draft, `Read these local files:\n${references}`);
}
