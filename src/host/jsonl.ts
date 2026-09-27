/**
 * The most text one record may hold, in UTF-16 code units. A 5,000-message
 * `get_messages` reply is about 5 million. The cap turns a runaway line into
 * an error instead of running the host out of memory.
 */
export const MAX_RECORD_CHARS = 256 * 1024 * 1024;

export class RecordTooLongError extends RangeError {
  override name = "RecordTooLongError";
}

/**
 * Splits pi's stdout into lines, the framing pi's rpc.md asks for: split on
 * LF only and strip a CR before it. readline also splits on U+2028 and
 * U+2029, which JSON allows inside strings, so it would cut records apart.
 *
 * Push decoded text, as from a stream with setEncoding("utf8"), so a
 * character split across two chunks arrives whole.
 */
export class LineSplitter {
  /** The start of a line whose LF hasn't arrived yet, in pieces. */
  private pending: string[] = [];
  private pendingChars = 0;
  private readonly onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(chunk: string): void {
    let start = 0;
    let newline = chunk.indexOf("\n");
    while (newline !== -1) {
      let line = chunk.slice(start, newline);
      if (this.pending.length > 0) {
        this.pending.push(line);
        line = this.pending.join("");
        this.pending = [];
        this.pendingChars = 0;
      }
      this.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      start = newline + 1;
      newline = chunk.indexOf("\n", start);
    }
    if (start === chunk.length) return;
    this.pendingChars += chunk.length - start;
    if (this.pendingChars > MAX_RECORD_CHARS) {
      this.pending = [];
      this.pendingChars = 0;
      throw new RecordTooLongError(
        `A record ran past ${MAX_RECORD_CHARS} characters without a newline`,
      );
    }
    this.pending.push(chunk.slice(start));
  }

  /** Returns the text after the last LF, which the stream ended without finishing. */
  end(): string {
    const rest = this.pending.join("");
    this.pending = [];
    this.pendingChars = 0;
    return rest;
  }
}
