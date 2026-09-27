// Main's log files: main.log for main's console output, and host.log for what
// the host prints. The rotation and its sizes are adapted from T3 Code's
// RotatingFileSink, in packages/shared/src/logging.ts, and
// apps/desktop/src/app/DesktopObservability.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

/**
 * A log file that moves to `<file>.1` once it would grow past `maxBytes`,
 * pushing older copies up to `<file>.<maxFiles>`. Writing never throws. The
 * first failure goes to stderr, since the log itself may be what's broken.
 */
export class LogFile {
  readonly file: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private size: number;
  private reportedFailure = false;

  constructor(file: string, { maxBytes = MAX_BYTES, maxFiles = MAX_FILES } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    mkdirSync(path.dirname(file), { recursive: true });
    this.removeCopiesPast(maxFiles);
    this.size = this.currentSize();
  }

  write(text: string): void {
    const bytes = Buffer.from(text);
    if (bytes.length === 0) return;
    try {
      if (this.size > 0 && this.size + bytes.length > this.maxBytes) this.rotate();
      appendFileSync(this.file, bytes);
      this.size += bytes.length;
    } catch (error) {
      if (!this.reportedFailure) {
        this.reportedFailure = true;
        process.stderr.write(`Tondo couldn't write its log ${this.file}: ${String(error)}\n`);
      }
      // A failed write or rotation leaves the size unknown, so read it again.
      try {
        this.size = this.currentSize();
      } catch {
        // The file can't be read either. Keep the size it had.
      }
    }
  }

  private rotate(): void {
    rmSync(this.copy(this.maxFiles), { force: true });
    for (let index = this.maxFiles - 1; index >= 1; index--) {
      renameIfPresent(this.copy(index), this.copy(index + 1));
    }
    renameIfPresent(this.file, this.copy(1));
    this.size = 0;
  }

  /** Removes the copies a larger maxFiles left behind. */
  private removeCopiesPast(maxFiles: number): void {
    const name = path.basename(this.file);
    for (const entry of readdirSync(path.dirname(this.file))) {
      if (!entry.startsWith(`${name}.`)) continue;
      const index = Number(entry.slice(name.length + 1));
      if (Number.isInteger(index) && index > maxFiles) {
        rmSync(path.join(path.dirname(this.file), entry), { force: true });
      }
    }
  }

  private currentSize(): number {
    try {
      return statSync(this.file).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  private copy(index: number): string {
    return `${this.file}.${index}`;
  }
}

function renameIfPresent(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Returns a function that writes text to `log`, starting each line with the
 * time and `label`. Text can end mid-line, as a chunk of a stream does.
 */
export function lineWriter(log: LogFile, label: string): (text: string) => void {
  let atLineStart = true;
  return (text) => {
    if (text === "") return;
    let stamped = "";
    // Splitting after each newline keeps it on the line it ends.
    for (const line of text.split(/(?<=\n)/)) {
      if (atLineStart) stamped += `${new Date().toISOString()} ${label} `;
      stamped += line;
      atLineStart = line.endsWith("\n");
    }
    log.write(stamped);
  };
}

const LEVELS = ["debug", "info", "log", "warn", "error"] as const;

/** Copies everything main prints through `console` into `log`, and still prints it. */
export function copyConsoleTo(log: LogFile): void {
  for (const level of LEVELS) {
    const print = console[level].bind(console);
    const write = lineWriter(log, level);
    console[level] = (...args: unknown[]) => {
      print(...args);
      write(`${format(...args)}\n`);
    };
  }
}
