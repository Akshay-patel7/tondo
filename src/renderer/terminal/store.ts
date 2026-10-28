import { create } from "zustand";
import { MAX_TERMINAL_PANES } from "../../shared/terminal";
import {
  removeTerminal,
  replaceTerminal,
  resizeSplit,
  terminalIds,
  type TerminalLayout,
} from "./layout";
import type { TerminalEvent, TerminalState } from "../../shared/terminal";

export const useTerminals = create<ReadonlyMap<string, readonly TerminalState[]>>(() => new Map());
export const useTerminalLayouts = create<ReadonlyMap<string, TerminalLayout>>(() => new Map());

function setLayout(threadId: string, layout: TerminalLayout | null): void {
  const layouts = new Map(useTerminalLayouts.getState());
  if (layout) layouts.set(threadId, layout);
  else layouts.delete(threadId);
  useTerminalLayouts.setState(layouts, true);
}

/** A visible selection focuses its pane; a hidden selection replaces only the focused pane. */
export function selectTerminal(threadId: string, terminalId: string): void {
  if (
    !useTerminals
      .getState()
      .get(threadId)
      ?.some((item) => item.id === terminalId)
  )
    return;
  const layout = useTerminalLayouts.getState().get(threadId);
  if (layout?.selected === terminalId) return;
  let root = layout?.root ?? terminalId;
  if (layout && !terminalIds(layout.root).includes(terminalId))
    root = replaceTerminal(layout.root, layout.selected, terminalId);
  setLayout(threadId, { root, selected: terminalId });
}

export function resizeTerminalSplit(threadId: string, id: string, ratio: number): void {
  const layout = useTerminalLayouts.getState().get(threadId);
  if (layout) setLayout(threadId, { ...layout, root: resizeSplit(layout.root, id, ratio) });
}

/** Used by non-React actions such as the command palette. Matches the focused pane. */
export function currentTerminal(threadId: string): TerminalState | undefined {
  const sessions = useTerminals.getState().get(threadId) ?? [];
  const selected = useTerminalLayouts.getState().get(threadId)?.selected;
  return sessions.find((session) => session.id === selected) ?? sessions.at(-1);
}

type Output = Extract<TerminalEvent, { type: "terminal-output" }>;
const readers = new Map<string, (message: Output) => void>();

/** Streamed output bypasses React. Only terminal state enters the store. */
export function receiveTerminal(message: TerminalEvent): void {
  if (message.type === "terminal-output") {
    readers.get(message.attachment)?.(message);
    return;
  }
  const sessions = useTerminals.getState().get(message.threadId) ?? [];
  const terminalId = message.terminal ? message.terminal.id : message.terminalId;
  const existing = sessions.some((item) => item.id === terminalId);
  if (!message.terminal && !existing) return;
  const terminal = message.terminal;
  let next: readonly TerminalState[];
  if (!terminal) next = sessions.filter((item) => item.id !== terminalId);
  else if (existing) next = sessions.map((item) => (item.id === terminal.id ? terminal : item));
  else next = [...sessions, terminal].toSorted((a, b) => Number(!!a.script) - Number(!!b.script));
  const terminals = new Map(useTerminals.getState());
  if (next.length) terminals.set(message.threadId, next);
  else terminals.delete(message.threadId);
  useTerminals.setState(terminals, true);

  const layout = useTerminalLayouts.getState().get(message.threadId);
  if (terminal && !existing) {
    const split = message.split;
    if (
      layout &&
      split &&
      terminalIds(layout.root).includes(split.terminalId) &&
      terminalIds(layout.root).length < MAX_TERMINAL_PANES
    ) {
      setLayout(message.threadId, {
        root: replaceTerminal(layout.root, split.terminalId, {
          id: `split-${terminal.id}`,
          direction: split.direction,
          ratio: 0.5,
          first: split.terminalId,
          second: terminal.id,
        }),
        selected: terminal.id,
      });
    } else selectTerminal(message.threadId, terminal.id);
  } else if (!terminal && layout) {
    const root = removeTerminal(layout.root, terminalId) ?? next.at(-1)?.id;
    setLayout(
      message.threadId,
      root
        ? {
            root,
            selected: layout.selected === terminalId ? terminalIds(root)[0]! : layout.selected,
          }
        : null,
    );
  }
}

export function readTerminal(attachment: string, receive: (message: Output) => void): () => void {
  readers.set(attachment, receive);
  return () => {
    readers.delete(attachment);
  };
}

export function resetTerminals(): void {
  useTerminals.setState(new Map(), true);
  useTerminalLayouts.setState(new Map(), true);
}
