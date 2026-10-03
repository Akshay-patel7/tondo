/** Raw history retained by the host; the page replays at most RENDERER_HISTORY_BYTES. */
export const TERMINAL_HISTORY_BYTES = 8 * 1024 * 1024;
export const TERMINAL_HISTORY_LINES = 5_000;
export const RENDERER_HISTORY_BYTES = 512 * 1024;
/** Unacknowledged output. The PTY pauses until xterm has parsed it. */
export const TERMINAL_WINDOW_BYTES = 64 * 1024;
export const TERMINAL_CHUNK_CHARS = 4_096;

export type TerminalKind = "shell" | "login";

export interface TerminalState {
  readonly id: string;
  readonly kind: TerminalKind;
  readonly status: "starting" | "running" | "exited" | "closing";
  readonly error: string | null;
  readonly exitCode: number | null;
}

/** No paths or executables come from the page. The host resolves them from the thread. */
export type TerminalCommand =
  | { type: "terminal-open"; threadId: string; kind: TerminalKind }
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
  | { type: "terminal-state"; threadId: string; terminal: TerminalState | null }
  | {
      type: "terminal-output";
      threadId: string;
      terminalId: string;
      attachment: string;
      sequence: number;
      data: string;
    };
