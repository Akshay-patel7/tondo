// A remark plugin that keeps each Markdown block's parse tree by its text.
// Streamdown parses every block of a message again whenever the message
// mounts, as it does when you switch to a thread, and micromark's parse is
// most of that work. Text already parsed in this window reuses its tree.
import { defaultRemarkPlugins } from "streamdown";
import { localFileLinks } from "./fileLinks";

/** A unified parser. `never` lets the processor's own parser type assign to it. */
export type Parse = (document: string, file: never) => unknown;

/** About 2,000 blocks: a few long replies, a few megabytes of trees. */
const PARSED_LIMIT = 2000;

/**
 * Leeway for a streaming block. Streamdown closes the unfinished Markdown at
 * the end of a reply before parsing, so each frame's text extends the
 * previous frame's except for those few closing characters.
 */
const CLOSING_SLACK = 32;

function grewFrom(next: string, previous: string): boolean {
  const kept = previous.length - CLOSING_SLACK;
  return kept > 0 && next.length >= previous.length && next.startsWith(previous.slice(0, kept));
}

/** Wraps `parse` so text it has parsed before gets a copy of the same tree. */
export function cacheParses(parse: Parse): Parse {
  const parsed = new Map<string, unknown>();
  let latest: string | undefined;
  return (document, file) => {
    const kept = parsed.get(document);
    // Later plugins may change the tree they get, so each parse gets its own copy.
    if (kept !== undefined) return structuredClone(kept);
    const tree = parse(document, file);
    // A block pi is still writing parses once a frame. Keep only its latest text.
    if (latest !== undefined && grewFrom(document, latest)) parsed.delete(latest);
    if (parsed.size >= PARSED_LIMIT) parsed.delete(parsed.keys().next().value!);
    parsed.set(document, structuredClone(tree));
    latest = document;
    return tree;
  };
}

/** unified runs it with the processor as `this`, after remark-parse has set the parser. */
function reuseParses(this: { parser: Parse | undefined }): void {
  if (this.parser) this.parser = cacheParses(this.parser);
}

/** Streamdown's own remark plugins, plus the parse cache. */
export const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), reuseParses, localFileLinks];
