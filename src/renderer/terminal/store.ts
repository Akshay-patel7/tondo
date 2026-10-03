import { create } from "zustand";
import type { TerminalEvent, TerminalState } from "../../shared/terminal";

export const useTerminals = create<ReadonlyMap<string, TerminalState>>(() => new Map());
type Output = Extract<TerminalEvent, { type: "terminal-output" }>;
const readers = new Map<string, (message: Output) => void>();

/** Terminal output never enters a React store. Only session metadata does. */
export function receiveTerminal(message: TerminalEvent): void {
  if (message.type === "terminal-output") {
    readers.get(message.attachment)?.(message);
    return;
  }
  const terminals = new Map(useTerminals.getState());
  if (message.terminal) terminals.set(message.threadId, message.terminal);
  else terminals.delete(message.threadId);
  useTerminals.setState(terminals, true);
}

export function readTerminal(attachment: string, receive: (message: Output) => void): () => void {
  readers.set(attachment, receive);
  return () => {
    readers.delete(attachment);
  };
}

export function resetTerminals(): void {
  useTerminals.setState(new Map(), true);
}
