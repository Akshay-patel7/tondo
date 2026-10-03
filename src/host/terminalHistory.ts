// The query families follow T3 Code's terminal/Manager.ts at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { TERMINAL_HISTORY_BYTES, TERMINAL_HISTORY_LINES } from "../shared/terminal";

// oxlint-disable-next-line eslint/no-control-regex -- these are terminal protocol introducers.
const CONTROL = /[\u001b\u0090\u0098\u009b\u009d-\u009f]/g;

/**
 * Keeps display controls, but not query/reply traffic. Control strings (OSC,
 * DCS, APC and PM) aren't replayed at all, including clipboard and title
 * commands. State spans PTY chunks and never retains an unbounded sequence.
 */
export class HistoryFilter {
  private mode: "text" | "escape" | "csi" | "string" = "text";
  private sequence = "";
  private escaped = false;
  private overflow = false;

  push(data: string): string {
    const kept: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const char = data[i]!;
      const code = data.charCodeAt(i);
      // A new introducer cancels an unfinished escape/CSI sequence, just as
      // xterm does. Otherwise ESC ESC [6n could survive as a replayed query.
      if (this.mode !== "string" && (code === 0x1b || code === 0x9b)) {
        this.mode = code === 0x1b ? "escape" : "csi";
        this.sequence = char;
        this.overflow = false;
        continue;
      }
      if (this.mode !== "string" && [0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
        this.mode = "string";
        this.sequence = "";
        this.escaped = false;
        continue;
      }
      if (this.mode !== "text" && (code === 0x18 || code === 0x1a)) {
        this.mode = "text";
        this.sequence = "";
        continue;
      }
      if (this.mode === "string") {
        if (code === 7 || code === 0x9c || (this.escaped && char === "\\")) this.mode = "text";
        this.escaped = code === 0x1b;
      } else if (this.mode === "csi") {
        if (code >= 0x40 && code <= 0x7e) {
          const body = this.sequence.slice(this.sequence.startsWith("\u001b") ? 2 : 1);
          const query =
            char === "n" ||
            char === "t" ||
            (char === "R" && /^[0-9;?]*$/.test(body)) ||
            (char === "c" && /^[>0-9;?]*$/.test(body)) ||
            ((char === "p" || char === "y") && /^[0-9;?]*\$$/.test(body)) ||
            (char === "q" && /^>[0-9;]*$/.test(body)) ||
            (char === "u" && body.startsWith("?"));
          if (!query && !this.overflow) kept.push(this.sequence + char);
          this.mode = "text";
          this.sequence = "";
        } else if (this.sequence.length < 256) this.sequence += char;
        else this.overflow = true;
      } else if (this.mode === "escape") {
        if (char === "[") {
          this.mode = "csi";
          this.sequence += char;
          this.overflow = false;
        } else if ("]P^_X".includes(char)) {
          this.mode = "string";
          this.sequence = "";
          this.escaped = false;
        } else if (code >= 0x20 && code <= 0x2f) {
          if (this.sequence.length < 256) this.sequence += char;
          else this.overflow = true;
        } else {
          // DECID is the two-byte device-identification query.
          if (!this.overflow && !(this.sequence === "\u001b" && char === "Z"))
            kept.push(this.sequence + char);
          this.mode = "text";
          this.sequence = "";
        }
      } else {
        CONTROL.lastIndex = i + 1;
        const end = CONTROL.exec(data)?.index ?? data.length;
        kept.push(data.slice(i, end));
        i = end - 1;
      }
    }
    return kept.join("");
  }
}

/** A chunk queue, so new output never recopies the whole history. */
export class TerminalHistory {
  private chunks: { data: Buffer; lines: number }[] = [];
  private bytes = 0;
  private lines = 0;
  private readonly filter = new HistoryFilter();

  private readonly maxBytes: number;
  private readonly maxLines: number;

  constructor(maxBytes = TERMINAL_HISTORY_BYTES, maxLines = TERMINAL_HISTORY_LINES) {
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
  }

  append(raw: string): void {
    const text = this.filter.push(raw);
    if (!text) return;
    const data = Buffer.from(text);
    // PTY chunks are small. Split oversized caller input too, so eviction
    // never drops a whole screen just because it arrived in one chunk.
    for (let start = 0; start < data.length; start += 4_096) {
      const part = Buffer.from(data.subarray(start, start + 4_096));
      let lines = 0;
      for (const byte of part) if (byte === 10) lines++;
      const previous = this.chunks.at(-1);
      if (previous && previous.data.length + part.length <= 4_096) {
        previous.data = Buffer.concat([previous.data, part]);
        previous.lines += lines;
      } else this.chunks.push({ data: part, lines });
      this.bytes += part.length;
      this.lines += lines;
      while (this.bytes > this.maxBytes || this.lines >= this.maxLines) {
        const first = this.chunks.shift()!;
        this.bytes -= first.data.length;
        this.lines -= first.lines;
      }
    }
  }

  tail(maxBytes: number): string {
    const tail: Buffer[] = [];
    let remaining = maxBytes;
    for (let i = this.chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const data = this.chunks[i]!.data;
      const part = data.subarray(Math.max(0, data.length - remaining));
      tail.push(part);
      remaining -= part.length;
    }
    const data = Buffer.concat(tail.toReversed());
    let start = 0;
    // Eviction can split a UTF-8 character. Never replay its continuation bytes.
    while (start < data.length && (data[start]! & 0xc0) === 0x80) start++;
    return data.subarray(start).toString("utf8");
  }
}
