// What the slash menu offers and how it searches. The ranking is adapted from
// T3 Code's apps/web/src/components/chat/composerSlashCommandSearch.ts and
// scoreQueryMatch in packages/shared/src/searchRanking.ts: an exact name
// first, then a name that starts with the query, then one with the query
// after a "-", "_", ":" or "/", then one that holds it, then one that holds
// its letters in order, and matches in the description after all of those.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { SlashCommand } from "../../shared/protocol";
import { BUILTIN_COMMANDS, isBuiltin, type BuiltinName } from "../../shared/slashCommands";

export interface SlashItem {
  /** What you type after "/". */
  readonly name: string;
  readonly description: string;
  /** "tondo" for pi's built-ins, which Tondo runs itself. */
  readonly source: "tondo" | SlashCommand["source"];
  /** The argument it takes, as pi's docs write it. */
  readonly argument?: string;
  /** Why Tondo can't run it, for a built-in it can't run yet. */
  readonly unavailable?: string;
}

/**
 * What the menu offers: the built-ins Tondo runs, then pi's commands, then
 * the built-ins Tondo can't run yet. A pi command named like a built-in is
 * left out, as pi's own menu leaves it out, since the built-in runs instead.
 */
export function slashItems(commands: readonly SlashCommand[]): SlashItem[] {
  const builtins = (Object.keys(BUILTIN_COMMANDS) as BuiltinName[]).map(builtinItem);
  const fromPi = commands
    .filter((command) => !isBuiltin(command.name))
    .map(({ name, description, source }): SlashItem => ({ name, description, source }));
  return [
    ...builtins.filter((item) => item.unavailable === undefined),
    ...fromPi,
    ...builtins.filter((item) => item.unavailable !== undefined),
  ];
}

function builtinItem(name: BuiltinName): SlashItem {
  return { name, source: "tondo", ...BUILTIN_COMMANDS[name] };
}

/**
 * The query the menu searches for while you type a message's leading
 * command, or null. The caret has to be at the end of the command's name,
 * since completing it inside the name would leave the rest behind.
 */
export function slashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  if (!/^\/\S*$/.test(before) || /^\S/.test(text.slice(caret))) return null;
  return before.slice(1);
}

/** The items that match `query`, best first. The ones Tondo can't run come last. */
export function searchSlash(items: readonly SlashItem[], query: string): SlashItem[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...items];
  const ranked: { item: SlashItem; index: number; score: number }[] = [];
  items.forEach((item, index) => {
    const score = scoreItem(item, wanted);
    if (score === null) return;
    ranked.push({
      item,
      index,
      score: item.unavailable === undefined ? score : score + UNAVAILABLE,
    });
  });
  return ranked.toSorted((a, b) => a.score - b.score || a.index - b.index).map(({ item }) => item);
}

/** Sorts what Tondo can't run after everything it can. */
const UNAVAILABLE = 10_000;

function scoreItem(item: SlashItem, query: string): number | null {
  const scores = [
    scoreMatch(item.name.toLowerCase(), query, NAME),
    scoreMatch(item.description.toLowerCase(), query, DESCRIPTION),
  ].filter((score) => score !== null);
  return scores.length === 0 ? null : Math.min(...scores);
}

interface Tiers {
  readonly exact: number;
  readonly prefix: number;
  readonly boundary: number;
  readonly includes: number;
  /** Letters in order, with others between them. Descriptions don't match this way. */
  readonly fuzzy?: number;
}

const NAME: Tiers = { exact: 0, prefix: 2, boundary: 4, includes: 6, fuzzy: 100 };
const DESCRIPTION: Tiers = { exact: 20, prefix: 22, boundary: 24, includes: 26 };
const BOUNDARIES = [" ", "-", "_", ":", "/"];

/** How well `value` matches `query`, lower being better, or null. Both are lowercase. */
function scoreMatch(value: string, query: string, tiers: Tiers): number | null {
  if (!value) return null;
  if (value === query) return tiers.exact;
  const longer = Math.min(64, Math.max(0, value.length - query.length));
  if (value.startsWith(query)) return tiers.prefix + longer;
  const boundary = BOUNDARIES.map((mark) => value.indexOf(`${mark}${query}`))
    .filter((index) => index !== -1)
    .map((index) => index + 1);
  if (boundary.length > 0) return tiers.boundary + Math.min(...boundary) * 2 + longer;
  const includes = value.indexOf(query);
  if (includes !== -1) return tiers.includes + includes * 2 + longer;
  if (tiers.fuzzy === undefined) return null;
  const fuzzy = scoreSubsequence(value, query);
  return fuzzy === null ? null : tiers.fuzzy + fuzzy;
}

/** How tightly `value` holds the letters of `query` in order, lower being tighter, or null. */
function scoreSubsequence(value: string, query: string): number | null {
  let next = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== query[next]) continue;
    if (first === -1) first = index;
    if (previous !== -1) gaps += index - previous - 1;
    previous = index;
    next++;
    if (next === query.length) {
      const span = index - first + 1 - query.length;
      return first * 2 + gaps * 3 + span + Math.min(64, value.length - query.length);
    }
  }
  return null;
}
