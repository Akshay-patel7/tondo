import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IPty } from "node-pty";
import { PROTOCOL_VERSION, type HostMessage } from "../shared/protocol";
import {
  RENDERER_HISTORY_BYTES,
  TERMINAL_CHUNK_CHARS,
  TERMINAL_WINDOW_BYTES,
  type TerminalCommand,
  type TerminalKind,
  type TerminalState,
} from "../shared/terminal";
import { drainGroup } from "./processGroup";
import { TerminalHistory } from "./terminalHistory";

export interface TerminalLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

interface Session {
  threadId: string;
  state: TerminalState;
  pty?: IPty;
  history: TerminalHistory;
  started: Promise<void>;
  closing?: Promise<void>;
  attachment: string | null;
  pending: string[];
  inFlight: Map<number, number>;
  sequence: number;
  paused: boolean;
  exited: boolean;
}

const v = PROTOCOL_VERSION;
const exec = promisify(execFile);

/** One terminal per thread. Output bypasses React and pauses at the parser's acknowledgement window. */
export class Terminals {
  private readonly sessions = new Map<string, Session>();
  private readonly groups = new Set<number>();
  private stopping = false;

  private readonly launch: (threadId: string, kind: TerminalKind) => Promise<TerminalLaunch>;
  private readonly send: (message: HostMessage) => void;
  private readonly reportGroups: (pgids: number[]) => void;

  constructor(
    launch: (threadId: string, kind: TerminalKind) => Promise<TerminalLaunch>,
    send: (message: HostMessage) => void,
    reportGroups: (pgids: number[]) => void,
  ) {
    this.launch = launch;
    this.send = send;
    this.reportGroups = reportGroups;
  }

  has(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  greet(): void {
    this.detachAll();
    for (const session of this.sessions.values()) this.publish(session);
  }

  detachAll(): void {
    for (const session of this.sessions.values()) this.detach(session);
  }

  handle(message: TerminalCommand): void | Promise<void> {
    if (message.type === "terminal-open") return this.open(message.threadId, message.kind);
    const session = this.sessions.get(message.threadId);
    // A late write, resize or cleanup from a disposed view must not reach its replacement.
    if (!session || session.state.id !== message.terminalId) return;
    switch (message.type) {
      case "terminal-close":
        return this.close(message.threadId);
      case "terminal-attach": {
        this.detach(session);
        session.attachment = message.attachment;
        if (!session.exited) session.pty?.resize(message.cols, message.rows);
        this.enqueue(session, session.history.tail(RENDERER_HISTORY_BYTES));
        this.pump(session);
        break;
      }
      case "terminal-detach":
        if (session.attachment === message.attachment) this.detach(session);
        break;
      case "terminal-write":
        if (session.state.status === "running") session.pty?.write(message.data);
        break;
      case "terminal-resize":
        if (session.state.status === "running") session.pty?.resize(message.cols, message.rows);
        break;
      case "terminal-ack":
        if (session.attachment === message.attachment) {
          session.inFlight.delete(message.sequence);
          this.pump(session);
        }
        break;
    }
  }

  private open(threadId: string, kind: TerminalKind): Promise<void> {
    if (this.stopping) throw new Error("Tondo is stopping its terminals.");
    const existing = this.sessions.get(threadId);
    if (existing) {
      if (existing.state.kind !== kind)
        throw new Error("Close this thread's terminal before opening a different one.");
      this.publish(existing);
      return existing.started;
    }
    const session: Session = {
      threadId,
      state: { id: randomUUID(), kind, status: "starting", error: null, exitCode: null },
      history: new TerminalHistory(),
      started: Promise.resolve(),
      attachment: null,
      pending: [],
      inFlight: new Map(),
      sequence: 0,
      paused: false,
      exited: false,
    };
    this.sessions.set(threadId, session);
    this.publish(session);
    session.started = this.start(session);
    return session.started;
  }

  private async start(session: Session): Promise<void> {
    try {
      const launch = await this.launch(session.threadId, session.state.kind);
      const { spawn } = await import("node-pty");
      if (session.state.status === "closing") return;
      const pty = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: { ...launch.env, TERM: "xterm-256color" },
        name: "xterm-256color",
        cols: 80,
        rows: 24,
      });
      session.pty = pty;
      this.groups.add(pty.pid);
      this.reportGroups([...this.groups]);
      pty.onData((data) => {
        session.history.append(data);
        if (session.attachment !== null) {
          this.enqueue(session, data);
          this.pump(session);
        }
      });
      pty.onExit(({ exitCode }) => {
        session.exited = true;
        session.state = { ...session.state, status: "exited", exitCode };
        // A shell can leave children in its group when it exits on its own.
        void this.cleanup(session).catch((error: unknown) => this.problem(session, error));
        this.publish(session);
      });
      session.state = { ...session.state, status: "running" };
      this.publish(session);
    } catch (error) {
      this.problem(session, error);
    }
  }

  async closeAll(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  async close(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.state = { ...session.state, status: "closing" };
    this.publish(session);
    await session.started;
    try {
      await this.cleanup(session);
    } catch (error) {
      delete session.closing;
      session.state = {
        ...session.state,
        status: session.exited ? "exited" : "running",
        error: `Couldn't stop the terminal: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.publish(session);
      throw error;
    }
    this.detach(session);
    if (this.sessions.get(threadId) === session) {
      this.sessions.delete(threadId);
      this.send({ v, type: "terminal-state", threadId, terminal: null });
    }
  }

  private cleanup(session: Session): Promise<void> {
    session.closing ??= (async () => {
      const pty = session.pty;
      if (!pty) return;
      // Job-control shells give foreground and background jobs their own
      // groups. Capture those before terminating the shell that parents them.
      const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,pgid="], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 2_000,
      });
      const rows = stdout
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([pty.pid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [pid, parent] of rows) {
          if (pid && parent && owned.has(parent) && !owned.has(pid)) {
            owned.add(pid);
            changed = true;
          }
        }
      }
      const groups = new Set([pty.pid]);
      for (const [pid, , group] of rows)
        if (pid && group && group > 1 && owned.has(pid)) groups.add(group);
      for (const group of groups) this.groups.add(group);
      this.reportGroups([...this.groups]);
      // Resume first so paused output doesn't keep the PTY's exit event waiting.
      if (session.paused && !session.exited) pty.resume();
      await Promise.all([...groups].map((group) => drainGroup(group, 1_000)));
      for (const group of groups) this.groups.delete(group);
      this.reportGroups([...this.groups]);
    })();
    return session.closing;
  }

  private enqueue(session: Session, data: string): void {
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + TERMINAL_CHUNK_CHARS, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
      session.pending.push(data.slice(start, end));
      start = end;
    }
  }

  private pump(session: Session): void {
    if (session.attachment === null) return;
    let bytes = [...session.inFlight.values()].reduce((total, size) => total + size, 0);
    while (session.pending.length > 0 && bytes < TERMINAL_WINDOW_BYTES) {
      const data = session.pending.shift()!;
      const sequence = ++session.sequence;
      const size = Buffer.byteLength(data);
      session.inFlight.set(sequence, size);
      bytes += size;
      this.send({
        v,
        type: "terminal-output",
        threadId: session.threadId,
        terminalId: session.state.id,
        attachment: session.attachment,
        sequence,
        data,
      });
    }
    const paused = session.pending.length > 0 || bytes >= TERMINAL_WINDOW_BYTES;
    if (paused !== session.paused && session.pty && !session.exited) {
      session.paused = paused;
      if (paused) session.pty.pause();
      else session.pty.resume();
    }
  }

  private detach(session: Session): void {
    session.attachment = null;
    session.pending = [];
    session.inFlight.clear();
    if (session.paused && !session.exited) session.pty?.resume();
    session.paused = false;
  }

  private publish(session: Session): void {
    this.send({ v, type: "terminal-state", threadId: session.threadId, terminal: session.state });
  }

  private problem(session: Session, error: unknown): void {
    session.state = {
      ...session.state,
      status: "exited",
      error: error instanceof Error ? error.message : String(error),
    };
    this.publish(session);
  }
}
