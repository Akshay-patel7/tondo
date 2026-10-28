/** Shared host retention, renderer replay and scrollback limits. */
export const TERMINAL_HISTORY_BYTES = 32 * 1024 * 1024;
export const TERMINAL_HISTORY_LINES = 50_000;
/** Unacknowledged output. The PTY pauses until xterm has parsed it. */
export const TERMINAL_WINDOW_BYTES = 64 * 1024;
export const TERMINAL_CHUNK_CHARS = 4_096;
/** Includes exited shells until the user deletes them. Script runs have their own limit. */
export const MAX_SHELL_TERMINALS = 8;
/** Bound simultaneous xterm buffers and GPU contexts. Hidden shells have no renderer. */
export const MAX_TERMINAL_PANES = 4;
export type TerminalKind = "shell" | "login";

export interface TerminalSplit {
  readonly terminalId: string;
  /** The divider direction: vertical is side by side, horizontal is stacked. */
  readonly direction: "vertical" | "horizontal";
}

export interface TerminalState {
  readonly id: string;
  readonly kind: TerminalKind;
  readonly number?: number;
  /** Present only on a dedicated project-script terminal. */
  readonly script?: { readonly name: string; readonly cwd: string };
  readonly status: "starting" | "running" | "exited" | "closing";
  readonly error: string | null;
  readonly exitCode: number | null;
}

/** No paths or executables come from the page. The host resolves them from the thread. */
export type TerminalCommand =
  | { type: "terminal-open"; threadId: string; kind: TerminalKind }
  | { type: "terminal-new"; threadId: string; split?: TerminalSplit }
  | { type: "terminal-close"; threadId: string; terminalId: string }
  | {
      type: "terminal-attach";
      threadId: string;
      terminalId: string;
      attachment: string;
      cols: number;
      rows: number;
    }
  | { type: "terminal-detach"; threadId: string; terminalId: string; attachment: string }
  | { type: "terminal-write"; threadId: string; terminalId: string; data: string }
  | { type: "terminal-resize"; threadId: string; terminalId: string; cols: number; rows: number }
  | {
      type: "terminal-ack";
      threadId: string;
      terminalId: string;
      attachment: string;
      sequence: number;
    };

export type TerminalEvent =
  | ({ type: "terminal-state"; threadId: string } & (
      | { terminal: TerminalState; split?: TerminalSplit }
      | { terminal: null; terminalId: string }
    ))
  | {
      type: "terminal-output";
      threadId: string;
      terminalId: string;
      attachment: string;
      sequence: number;
      data: string;
    };
