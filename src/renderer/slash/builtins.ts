// Runs pi's built-in slash commands the way Tondo does them (docs/plan.md,
// Stage 7). pi runs them only in its terminal UI, so none reaches pi as text.
import { isLoginProvider } from "../../shared/protocol";
import {
  BUILTIN_COMMANDS,
  canRun,
  findModel,
  pathArgument,
  type BuiltinName,
  type RunName,
} from "../../shared/slashCommands";
import { newThreadHere, runPaletteAction } from "../commands";
import {
  compactContext,
  openTerminal,
  copyLastReply,
  exportThread,
  reloadPi,
  renameThread,
  setModel,
  setThinkingLevel,
  showSessionInfo,
  showTrust,
  useHost,
} from "../connection";
import { openPalette } from "../palette/store";
import { openSettings } from "../settings/store";
import { openSheet } from "../sheets/store";
import { addToast } from "../toasts/store";

/** Runs `/name args`. Tondo shows why for a built-in it can't run yet. */
export function runBuiltin(name: BuiltinName, args: string): void {
  if (canRun(name)) RUN[name](args);
  else tell(BUILTIN_COMMANDS[name].unavailable ?? `Tondo can't run /${name}.`);
}

const RUN: Record<RunName, (args: string) => void> = {
  login: (args) => {
    const provider = args.trim();
    if (provider === "") openTerminal("login");
    else if (isLoginProvider(provider)) openTerminal("login", provider);
    else tell('Type a provider\'s id after /login, such as "/login anthropic".');
  },
  logout: () => openTerminal("login"),
  model: (args) => {
    const session = readySession();
    if (!session) return;
    if (!args) {
      openPicker("model");
      return;
    }
    const model = findModel(args, session.models);
    if (model) {
      setModel(model.provider, model.id);
      return;
    }
    tell(`pi has no model "${args}". Pick one from the list.`);
    openPicker("model");
  },
  "scoped-models": () => {
    if (readySession()) openPicker("model");
  },
  thinking: (args) => {
    const session = readySession();
    if (!session) return;
    const { thinkingLevels } = session;
    if (thinkingLevels.length < 2) {
      tell("The model doesn't think, so it has no thinking level to pick.");
      return;
    }
    if (!args) {
      openPicker("thinking");
      return;
    }
    const level = thinkingLevels.find((candidate) => candidate === args.toLowerCase());
    if (level) setThinkingLevel(level);
    else tell(`Unknown thinking level "${args}". Available levels: ${thinkingLevels.join(", ")}.`);
  },
  new: () => newThreadHere(),
  resume: () => openPalette(),
  name: (args) => {
    const thread = shownThread();
    if (!thread) return;
    // pi saves a name in the session file, which it writes with the first reply.
    if (!thread.canRename) tell("You can name the thread once pi has replied in it.");
    else if (args) renameThread(thread.id, args);
    else runPaletteAction({ type: "rename-thread", threadId: thread.id });
  },
  session: () => {
    if (readySession()) showSessionInfo();
  },
  compact: (args) => {
    if (readySession()) compactContext(args);
  },
  copy: () => {
    if (readySession()) copyLastReply();
  },
  export: (args) => {
    if (readySession()) exportThread(pathArgument(args));
  },
  reload: () => {
    if (readySession()) reloadPi();
  },
  settings: () => openSettings("pi"),
  hotkeys: () => openSheet({ kind: "hotkeys" }),
  trust: () => {
    if (readySession()) showTrust();
  },
};

/** pi's session in the thread on screen, or undefined after saying pi isn't running. */
function readySession() {
  const pi = useHost.getState().thread?.pi;
  if (pi?.state === "ready") return pi.session;
  tell(pi?.state === "starting" ? "pi is still starting." : "pi isn't running in this thread.");
  return undefined;
}

/** The thread on screen as the sidebar lists it. */
function shownThread() {
  const { thread, projects } = useHost.getState();
  return projects.flatMap(({ threads }) => threads).find(({ id }) => id === thread?.id);
}

/** Focuses the model or thinking level picker and opens its list, as a click on it would. */
function openPicker(picker: "model" | "thinking"): void {
  const trigger = document.querySelector<HTMLElement>(`[data-picker="${picker}"]`);
  if (!trigger) return;
  trigger.focus();
  trigger.click();
}

function tell(message: string): void {
  addToast({ level: "info", message });
}
