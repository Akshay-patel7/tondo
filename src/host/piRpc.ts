import type { Readable, Writable } from "node:stream";
import { LineSplitter, RecordTooLongError } from "./jsonl";

/** A record pi writes to stdout: a response or an event. */
export type PiRecord = { type: string } & Record<string, unknown>;
/** A command Tondo writes to pi's stdin. */
export type PiCommand = { type: string } & Record<string, unknown>;
export interface PiResponse extends PiRecord {
  type: "response";
  command: string;
  success: true;
  data?: unknown;
}

/** How long a command waits for its response unless the caller says otherwise. */
export const COMMAND_DEADLINE_MS = 30_000;
/** How much of pi's stderr is kept for error reports. */
export const STDERR_TAIL_CHARS = 16 * 1024;
/** How much of a bad line an error message quotes. */
const EXCERPT_CHARS = 200;

export class PiCommandError extends Error {
  override name = "PiCommandError";
}

export interface PiStdio {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export interface PiRpcHandlers {
  /** Every record that isn't a response, in the order pi wrote them. */
  onRecord: (record: PiRecord) => void;
  /** Something pi wrote that breaks the protocol. The client skips it. */
  onProtocolError: (message: string) => void;
}

interface Waiting {
  command: string;
  resolve: (response: PiResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | undefined;
}

const excerpt = (text: string) =>
  text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS)}… (${text.length} characters)`
    : text;

/**
 * Speaks pi's RPC protocol over its stdio, as pi's rpc.md describes: JSONL
 * framing, responses matched to commands by id, events passed on in order.
 * It never parses stderr, only keeps its tail.
 */
export class PiRpc {
  private nextId = 0;
  private readonly waiting = new Map<string, Waiting>();
  /** Lines held back until stdin drains. */
  private readonly unsent: string[] = [];
  private backedUp = false;
  private stderr = "";
  private closedBecause: Error | undefined;
  private readonly io: PiStdio;
  private readonly handlers: PiRpcHandlers;

  constructor(io: PiStdio, handlers: PiRpcHandlers) {
    this.io = io;
    this.handlers = handlers;
    const splitter = new LineSplitter((line) => this.receive(line));
    io.stdout.setEncoding("utf8");
    io.stdout.on("data", (chunk: string) => {
      try {
        splitter.push(chunk);
      } catch (error) {
        // Anything else came from a handler. That's Tondo's bug, not pi's.
        if (!(error instanceof RecordTooLongError)) throw error;
        handlers.onProtocolError(error.message);
      }
    });
    io.stdout.on("end", () => {
      const rest = splitter.end();
      if (rest) handlers.onProtocolError(`pi's output ended inside a record: ${excerpt(rest)}`);
    });
    io.stderr.setEncoding("utf8");
    io.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL_CHARS);
    });
    io.stdin.on("drain", () => this.flush());
    // Writing to a pi that has exited fails with EPIPE. Its waiting commands
    // fail when the process closes, so the error itself needs no handling.
    io.stdin.on("error", () => {});
    io.stdout.on("error", (error) =>
      handlers.onProtocolError(`pi's stdout failed: ${error.message}`),
    );
  }

  /**
   * Sends `command` and resolves with pi's response, or rejects if pi reports
   * a failure, doesn't answer within `deadlineMs`, or exits first.
   */
  request(command: PiCommand, deadlineMs = COMMAND_DEADLINE_MS): Promise<PiResponse> {
    if (this.closedBecause) return Promise.reject(this.closedBecause);
    this.nextId++;
    const id = `tondo-${this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = Number.isFinite(deadlineMs)
        ? setTimeout(() => {
            this.waiting.delete(id);
            const stalled = this.backedUp ? " It has stopped reading its input." : "";
            reject(
              new PiCommandError(
                `pi didn't answer ${command.type} within ${deadlineMs} ms.${stalled}`,
              ),
            );
          }, deadlineMs)
        : undefined;
      this.waiting.set(id, { command: command.type, resolve, reject, timer });
      this.write({ ...command, id });
    });
  }

  /** Sends a record pi doesn't answer, such as an extension_ui_response. */
  send(record: PiCommand): void {
    if (this.closedBecause) throw this.closedBecause;
    this.write(record);
  }

  /** The end of what pi wrote to stderr. */
  stderrTail(): string {
    return this.stderr;
  }

  /** Fails every waiting command, and every later one, with `error`. */
  close(error: Error): void {
    this.closedBecause = error;
    this.unsent.length = 0;
    for (const waiting of this.waiting.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.waiting.clear();
  }

  private write(record: PiCommand): void {
    const line = `${JSON.stringify(record)}\n`;
    if (this.backedUp) this.unsent.push(line);
    else this.backedUp = !this.io.stdin.write(line);
  }

  private flush(): void {
    this.backedUp = false;
    let line = this.unsent.shift();
    while (line !== undefined) {
      if (!this.io.stdin.write(line)) {
        this.backedUp = true;
        return;
      }
      line = this.unsent.shift();
    }
  }

  private receive(line: string): void {
    if (!line) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      this.handlers.onProtocolError(`pi wrote a line that isn't JSON: ${excerpt(line)}`);
      return;
    }
    if (
      typeof record !== "object" ||
      record === null ||
      typeof (record as PiRecord).type !== "string"
    ) {
      this.handlers.onProtocolError(`pi wrote a record without a type: ${excerpt(line)}`);
      return;
    }
    if ((record as PiRecord).type === "response") this.answer(record as PiRecord, line);
    else this.handlers.onRecord(record as PiRecord);
  }

  private answer(response: PiRecord, line: string): void {
    const id = typeof response.id === "string" ? response.id : undefined;
    const waiting = id === undefined ? undefined : this.waiting.get(id);
    if (!id || !waiting) {
      // A parse error has no id, and a late answer's command has timed out.
      this.handlers.onProtocolError(`pi answered no waiting command: ${excerpt(line)}`);
      return;
    }
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    if (response.success === true) {
      waiting.resolve(response as PiResponse);
    } else {
      const reason = typeof response.error === "string" ? response.error : "no reason given";
      waiting.reject(new PiCommandError(`pi couldn't run ${waiting.command}: ${reason}`));
    }
  }
}
