// Display-only evidence of tools using another checkout. Never adopt it into
// the ownership ledger or change where pi, terminals or Git actions run.
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentCheckout } from "../shared/git";
import type { ThreadState } from "../shared/thread";
import type { Git } from "./git";

const FILE_TOOLS = new Set(["read", "write", "edit"]);

/** A literal shell word, without evaluating substitutions or expanding variables. */
function word(input: string): { value: string; rest: string } | null {
  const source = input.trimStart();
  let value = "";
  let quote = "";
  let i = 0;
  for (; i < source.length; i++) {
    const char = source[i]!;
    if (!quote && /[\s;&|<>]/.test(char)) break;
    if (char === quote) quote = "";
    else if (!quote && (char === "'" || char === '"')) quote = char;
    else if (char === "\\" && quote !== "'") {
      const next = source[++i];
      if (!next || next === "\n") return null;
      if (quote === '"' && !/[$`"\\]/.test(next)) value += "\\";
      value += next;
    } else {
      if (quote !== "'" && "$`~*?{}()[]#".includes(char)) return null;
      value += char;
    }
  }
  return quote || i === 0 ? null : { value, rest: source.slice(i) };
}

/**
 * Recognize explicit literal locations only. Complex shell programs are not a
 * reliable statement of cwd, and must never be executed to discover one.
 */
export function toolDirectory(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
): string | null {
  if (FILE_TOOLS.has(name))
    return typeof args.path === "string" ? path.resolve(cwd, args.path) : null;
  if (name !== "bash" || typeof args.command !== "string") return null;
  let command = args.command;
  let directory = cwd;
  // Consume literal `cd ... &&` prefixes, including one before `git -C`.
  let first = word(command);
  while (first?.value === "cd") {
    let target = word(first.rest);
    if (target?.value === "--") target = word(target.rest);
    if (!target?.value || !/^\s*(?:&&|$)/.test(target.rest)) return null;
    directory = path.resolve(directory, target.value);
    if (!target.rest.trim()) return directory;
    command = target.rest.trimStart().slice(2);
    first = word(command);
  }
  if (!first) return null;
  if (first.value === "git") {
    const option = word(first.rest);
    if (option?.value === "-C") {
      const target = word(option.rest);
      if (!target?.value || /(?:\b(?:cd|pushd|popd)\s|\s-C\s)/.test(target.rest)) return null;
      return path.resolve(directory, target.value);
    }
  }
  // Don't mistake a directory change hidden in a compound command for a tool
  // running in pi's starting folder. Unsupported forms leave no activity badge.
  if (/\b(?:cd|pushd|popd)\s|\s-C\s/.test(command)) return null;
  return directory;
}

function locations(state: ThreadState, cwd: string): readonly (string | null)[] {
  const results = new Map<string, boolean>();
  const active: (string | null)[] = [];
  let latest: (string | null)[] | undefined;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]!;
    if (message.role === "toolResult") results.set(message.toolCallId, !message.isError);
    if (message.role !== "assistant") continue;
    for (const block of message.content.toReversed()) {
      if (block.type !== "toolCall" || (block.name !== "bash" && !FILE_TOOLS.has(block.name)))
        continue;
      const running = state.tools[block.id];
      if (running && !running.isError) active.push(toolDirectory(block.name, block.arguments, cwd));
      else if (!latest && results.get(block.id))
        latest = [toolDirectory(block.name, block.arguments, cwd)];
    }
  }
  return active.length ? active : (latest ?? []);
}

/** Reconstructed from pi's transcript, so page reloads and cold restarts agree. */
export async function agentCheckout(
  git: Git,
  cwd: string,
  checkoutRoot: string,
  state: ThreadState,
): Promise<AgentCheckout | null> {
  const candidates = locations(state, cwd);
  if (!candidates.length || candidates.some((candidate) => candidate === null)) return null;
  // The usual case needs no extra Git processes.
  if (candidates.every((candidate) => candidate === cwd)) return null;
  const listing = await git.run(cwd, ["worktree", "list", "--porcelain", "-z"]);
  const worktrees = new Map<string, string | null>();
  for (const record of listing.split("\0\0")) {
    const fields = record.split("\0");
    const root = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18);
    if (root && !fields.some((field) => field.startsWith("prunable")))
      worktrees.set(root, branch ?? null);
  }
  const roots = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const resolved = await realpath(candidate!);
        const directory = (await stat(resolved)).isDirectory() ? resolved : path.dirname(resolved);
        const root = (await git.run(directory, ["rev-parse", "--show-toplevel"])).replace(
          /\n$/,
          "",
        );
        return worktrees.has(root) ? root : null;
      } catch {
        // Removed paths, unrelated repositories and failed commands aren't evidence.
        return null;
      }
    }),
  );
  const root = roots[0];
  if (!root || root === checkoutRoot || roots.some((other) => other !== root)) return null;
  return { root, branch: worktrees.get(root)! };
}
