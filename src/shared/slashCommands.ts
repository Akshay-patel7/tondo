// pi's built-in slash commands, and what Tondo does with each. pi runs them
// only in its terminal UI. Sent as a prompt over RPC they reach the model as
// plain text (pi's rpc-commands.md, get_commands), so Tondo never sends one to
// pi. It runs its own version, or says why it can't.

/** pi's built-ins that Tondo runs its own way. */
export type RunName =
  | "login"
  | "logout"
  | "model"
  | "scoped-models"
  | "thinking"
  | "new"
  | "resume"
  | "name"
  | "session"
  | "compact"
  | "copy"
  | "export"
  | "reload"
  | "settings"
  | "hotkeys"
  | "trust";

/** pi's built-ins that Tondo can't run yet. */
export type LaterName =
  | "tree"
  | "fork"
  | "clone"
  | "import"
  | "share"
  | "bug"
  | "changelog"
  | "llama"
  | "quit";

/** Every command pi's slash-commands.md and its terminal UI list as built in. */
export type BuiltinName = RunName | LaterName;

export interface BuiltinCommand {
  /** What the command does in Tondo, for the slash menu. */
  readonly description: string;
  /** Its argument as pi's docs write it, if it takes one. */
  readonly argument?: string;
  /** Why Tondo can't run it. Tondo shows this instead. */
  readonly unavailable?: string;
}

const RUNS: Readonly<Record<RunName, BuiltinCommand & { unavailable?: never }>> = {
  model: { description: "Pick the model", argument: "[provider/model]" },
  "scoped-models": { description: "Pick the model" },
  thinking: { description: "Pick the thinking level", argument: "[level]" },
  new: { description: "Start a new thread in this project" },
  resume: { description: "Switch to another thread" },
  name: { description: "Rename the thread", argument: "[name]" },
  session: { description: "Show the session's file, messages, tokens and cost" },
  compact: { description: "Compact the context", argument: "[instructions]" },
  copy: { description: "Copy pi's last reply" },
  export: { description: "Save the thread as an HTML file", argument: "[path]" },
  reload: { description: "Restart pi to reload extensions, skills, prompts and context files" },
  settings: { description: "Show where pi's settings are" },
  hotkeys: { description: "Show keyboard shortcuts" },
  trust: { description: "Change whether pi trusts this project" },
  login: { description: "Open pi's terminal to sign in to a provider", argument: "[provider]" },
  logout: { description: "Open pi's terminal to sign out of a provider" },
};

const TERMINAL = "pi's terminal UI can.";

const LATER: Readonly<Record<LaterName, BuiltinCommand & { unavailable: string }>> = {
  tree: {
    description: "Navigate the session tree",
    unavailable: "The session tree comes after Tondo v1.",
  },
  fork: {
    description: "Fork from an earlier message",
    unavailable: "Forking comes after Tondo v1, with the session tree.",
  },
  clone: {
    description: "Duplicate the session",
    unavailable: "Cloning comes after Tondo v1, with the session tree.",
  },
  import: {
    description: "Import a session from a JSONL file",
    argument: "<path>",
    unavailable: `Tondo v1 can't import sessions. ${TERMINAL}`,
  },
  share: {
    description: "Share the session",
    unavailable: `Tondo v1 can't share sessions. ${TERMINAL}`,
  },
  bug: {
    description: "Report a bug to pi's developers",
    argument: "[description]",
    unavailable: `Tondo v1 can't send pi bug reports. ${TERMINAL}`,
  },
  changelog: {
    description: "Show pi's changelog",
    unavailable: "Tondo v1 doesn't show pi's changelog. pi's terminal UI does.",
  },
  llama: {
    description: "Manage llama.cpp models",
    unavailable: `Tondo v1 can't manage llama.cpp models. ${TERMINAL}`,
  },
  quit: {
    description: "Quit",
    unavailable: "Tondo doesn't quit with /quit. Quit it from its menu.",
  },
};

/** Every built-in, the ones Tondo runs first. */
export const BUILTIN_COMMANDS: Readonly<Record<BuiltinName, BuiltinCommand>> = {
  ...RUNS,
  ...LATER,
};

/** Whether Tondo runs the built-in `name`, rather than saying why it can't. */
export function canRun(name: BuiltinName): name is RunName {
  return Object.hasOwn(RUNS, name);
}

/** A message that starts with "/": the command's name and the text after it. */
export interface SlashText {
  readonly name: string;
  readonly args: string;
}

/** Splits a message that starts with "/" into the command's name and the rest, or returns null. */
export function parseSlash(text: string): SlashText | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1]!, args: (match[2] ?? "").trim() };
}

export function isBuiltin(name: string): name is BuiltinName {
  return Object.hasOwn(BUILTIN_COMMANDS, name);
}

/** The built-in command `text` runs, if it starts with one. */
export function builtinIn(text: string): { name: BuiltinName; args: string } | null {
  const slash = parseSlash(text);
  return slash && isBuiltin(slash.name) ? { name: slash.name, args: slash.args } : null;
}

/**
 * The path in a command's text, as pi's getPathCommandArgument reads it: the
 * first word, or a quoted string. Empty if there's none, or a quote isn't closed.
 */
export function pathArgument(args: string): string {
  const text = args.trimStart();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    return end < 0 ? "" : text.slice(1, end);
  }
  const space = text.search(/\s/);
  return space < 0 ? text : text.slice(0, space);
}

/**
 * The model `reference` names, the way pi's findExactModelReferenceMatch
 * finds one: "provider/id" or an id that only one provider has, ignoring case.
 */
export function findModel<M extends { readonly provider: string; readonly id: string }>(
  reference: string,
  models: readonly M[],
): M | undefined {
  const wanted = reference.trim().toLowerCase();
  if (!wanted) return undefined;
  const full = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === wanted);
  if (full.length > 0) return onlyOne(full);
  const slash = wanted.indexOf("/");
  if (slash !== -1) {
    const [provider, id] = [wanted.slice(0, slash).trim(), wanted.slice(slash + 1).trim()];
    const split = models.filter(
      (model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id,
    );
    if (provider && id && split.length > 0) return onlyOne(split);
  }
  return onlyOne(models.filter((model) => model.id.toLowerCase() === wanted));
}

/** The match if there's exactly one. pi takes none rather than guess. */
function onlyOne<M>(matches: readonly M[]): M | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}
