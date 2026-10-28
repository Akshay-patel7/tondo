import { create } from "zustand";
import type {
  TerminalContextPreview,
  TerminalContextState,
  TerminalEvent,
  TerminalState,
} from "../../shared/terminal";

export const useTerminals = create<ReadonlyMap<string, TerminalState>>(() => new Map());
export const useScriptTerminals = create<ReadonlyMap<string, readonly TerminalState[]>>(
  () => new Map(),
);
export const useTerminalSelection = create<ReadonlyMap<string, string>>(() => new Map());

export function selectTerminal(threadId: string, terminalId: string): void {
  useTerminalSelection.setState(
    new Map(useTerminalSelection.getState()).set(threadId, terminalId),
    true,
  );
}

/** Used by non-React actions such as the command palette. Matches the drawer selection. */
export function currentTerminal(threadId: string): TerminalState | undefined {
  const primary = useTerminals.getState().get(threadId);
  const scripts = useScriptTerminals.getState().get(threadId) ?? [];
  const selected = useTerminalSelection.getState().get(threadId);
  const script = scripts.find((session) => session.id === selected);
  if (script) return script;
  if (primary?.id === selected) return primary;
  return scripts.at(-1) ?? primary;
}

function forgetSelection(threadId: string, terminalId: string): void {
  if (useTerminalSelection.getState().get(threadId) !== terminalId) return;
  const selected = new Map(useTerminalSelection.getState());
  selected.delete(threadId);
  useTerminalSelection.setState(selected, true);
}

export const useTerminalContexts = create<
  ReadonlyMap<string, TerminalContextState & { preview?: TerminalContextPreview }>
>(() => new Map());
type Output = Extract<TerminalEvent, { type: "terminal-output" }>;
const readers = new Map<string, (message: Output) => void>();

/** Streamed output bypasses React. Only availability and explicitly requested previews enter a store. */
export function receiveTerminal(message: TerminalEvent): void {
  if (message.type === "terminal-output") {
    readers.get(message.attachment)?.(message);
    return;
  }
  if (message.type === "terminal-context" || message.type === "terminal-preview") {
    const contexts = new Map(useTerminalContexts.getState());
    const previous = contexts.get(message.threadId);
    contexts.set(
      message.threadId,
      message.type === "terminal-context"
        ? {
            enabled: message.enabled,
            pending: message.pending,
            ...(message.pending && previous?.preview ? { preview: previous.preview } : {}),
          }
        : {
            enabled: previous?.enabled ?? false,
            pending: previous?.pending ?? false,
            preview: { text: message.text, truncated: message.truncated },
          },
    );
    useTerminalContexts.setState(contexts, true);
    return;
  }
  const scripts = useScriptTerminals.getState().get(message.threadId) ?? [];
  const terminalId = message.terminal ? message.terminal.id : message.terminalId;
  if (message.terminal?.script || scripts.some((item) => item.id === terminalId)) {
    const existing = scripts.some((item) => item.id === terminalId);
    const terminal = message.terminal;
    let next = scripts.filter((item) => item.id !== terminalId);
    if (terminal)
      next = existing
        ? scripts.map((item) => (item.id === terminal.id ? terminal : item))
        : [...scripts, terminal];
    const all = new Map(useScriptTerminals.getState());
    if (next.length) all.set(message.threadId, next);
    else all.delete(message.threadId);
    useScriptTerminals.setState(all, true);
    if (!existing && terminal) selectTerminal(message.threadId, terminal.id);
    if (!terminal) forgetSelection(message.threadId, terminalId);
    return;
  }
  const terminals = new Map(useTerminals.getState());
  const previous = terminals.get(message.threadId);
  if (message.terminal) {
    terminals.set(message.threadId, message.terminal);
    if (previous?.id !== message.terminal.id) selectTerminal(message.threadId, message.terminal.id);
  } else if (previous?.id === terminalId) terminals.delete(message.threadId);
  useTerminals.setState(terminals, true);
  if (!message.terminal) forgetSelection(message.threadId, terminalId);
}

export function readTerminal(attachment: string, receive: (message: Output) => void): () => void {
  readers.set(attachment, receive);
  return () => {
    readers.delete(attachment);
  };
}

export function resetTerminals(): void {
  useTerminals.setState(new Map(), true);
  useScriptTerminals.setState(new Map(), true);
  useTerminalSelection.setState(new Map(), true);
  useTerminalContexts.setState(new Map(), true);
}
