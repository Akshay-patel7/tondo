import { create } from "zustand";
import type {
  TerminalContextPreview,
  TerminalContextState,
  TerminalEvent,
  TerminalState,
} from "../../shared/terminal";

export const useTerminals = create<ReadonlyMap<string, TerminalState>>(() => new Map());
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
  useTerminalContexts.setState(new Map(), true);
}
