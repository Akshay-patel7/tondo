// The composer's keys are pi's (docs/usage.md in pi-coding-agent): Enter
// sends, and steers while pi works. Alt+Enter queues a follow-up. Alt+Up
// takes the queue back into the composer. Escape stops pi. Shift+Enter adds
// a line, which is the textarea's own behavior.

export type ComposerAction = "send" | "follow-up" | "stop" | "dequeue";

export interface KeyPress {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** True while an input method is composing text, when Enter picks a candidate. */
  readonly isComposing: boolean;
}

export interface ComposerState {
  /** pi is running a turn or compacting. */
  readonly working: boolean;
  /** pi's queue holds messages. */
  readonly queued: boolean;
}

/** What `press` does in the composer, or null to leave it to the textarea. */
export function composerAction(press: KeyPress, state: ComposerState): ComposerAction | null {
  if (press.isComposing || press.ctrlKey || press.metaKey) return null;
  const { key, altKey, shiftKey } = press;
  if (key === "Enter" && !shiftKey) return altKey ? "follow-up" : "send";
  if (key === "Escape" && !altKey && !shiftKey && state.working) return "stop";
  if (key === "ArrowUp" && altKey && !shiftKey && state.queued) return "dequeue";
  return null;
}
