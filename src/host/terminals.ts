import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { IPty } from "node-pty";
import { MAX_SCRIPT_TERMINALS } from "../shared/projectScripts";
import { PROTOCOL_VERSION, type HostMessage, type TerminalRequest } from "../shared/protocol";
import {
  MAX_SHELL_TERMINALS,
  TERMINAL_CHUNK_CHARS,
  TERMINAL_HISTORY_BYTES,
  TERMINAL_WINDOW_BYTES,
  type TerminalKind,
  type TerminalSplit,
  type TerminalState,
} from "../shared/terminal";
import { LoginTyper } from "./loginTyper";
import { drainGroup } from "./processGroup";
import { HistoryFilter, TerminalHistory } from "./terminalHistory";
import { TerminalContext, type TerminalContextSend } from "./terminalContext";

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
  input: HistoryFilter;
  pasting: boolean;
  capturing: boolean;
  started: Promise<void>;
  closing?: Promise<void>;
  attachment: string | null;
  pending: string[];
  inFlight: Map<number, number>;
  sequence: number;
  paused: boolean;
  exited: boolean;
  /** Types /login for a new login terminal that names a provider. */
  typer?: LoginTyper;
}

const v = PROTOCOL_VERSION;
const exec = promisify(execFile);

/** Bounded interactive shells and separate script runs per thread. Output bypasses React. */
export class Terminals {
  private readonly sessions = new Map<string, Session>();
  private readonly groups = new Set<number>();
  private readonly contexts = new Map<string, TerminalContext>();
  private stopping = false;
  private adapter?: Promise<typeof import("node-pty")>;

  private readonly launch: (threadId: string, kind: TerminalKind) => Promise<TerminalLaunch>;
  private readonly send: (message: HostMessage) => void;
  private readonly reportGroups: (pgids: number[]) => void;
  private readonly ended: ((threadId: string, kind: TerminalKind) => void) | undefined;
  private readonly readSharing: (threadId: string) => boolean;

  /** `ended` hears of each terminal whose process exits, unless Tondo is stopping its terminals. */
  constructor(
    launch: (threadId: string, kind: TerminalKind) => Promise<TerminalLaunch>,
    send: (message: HostMessage) => void,
    reportGroups: (pgids: number[]) => void,
    ended?: (threadId: string, kind: TerminalKind) => void,
    readSharing: (threadId: string) => boolean = () => false,
  ) {
    this.launch = launch;
    this.send = send;
    this.reportGroups = reportGroups;
    this.ended = ended;
    this.readSharing = readSharing;
  }

  has(threadId: string): boolean {
    return [...this.sessions.values()].some((session) => session.threadId === threadId);
  }

  /** Script runs can target an agent checkout different from their thread's original folder. */
  scriptDirectories(): string[] {
    return [...this.sessions.values()].flatMap((session) =>
      session.state.script?.cwd ? [session.state.script.cwd] : [],
    );
  }

  private primary(threadId: string): Session | undefined {
    return [...this.sessions.values()].find(
      (session) => session.threadId === threadId && !session.state.script,
    );
  }

  openScript(threadId: string, name: string, launch: () => Promise<TerminalLaunch>): Promise<void> {
    if (this.stopping) throw new Error("Tondo is stopping its terminals.");
    const count = [...this.sessions.values()].filter(
      (session) => session.threadId === threadId && session.state.script,
    ).length;
    if (count >= MAX_SCRIPT_TERMINALS)
      throw new Error(
        `Close a script terminal before starting another. Each thread can keep ${MAX_SCRIPT_TERMINALS}.`,
      );
    return this.create(threadId, "shell", undefined, { name, launch });
  }

  greet(): void {
    this.detachAll();
    for (const session of this.sessions.values()) this.publish(session);
    for (const threadId of this.contexts.keys()) this.publishContext(threadId);
  }

  private context(threadId: string): TerminalContext {
    let context = this.contexts.get(threadId);
    if (!context) {
      context = new TerminalContext(this.readSharing(threadId));
      this.contexts.set(threadId, context);
    }
    return context;
  }

  publishContext(threadId: string): void {
    const context = this.context(threadId);
    this.send({
      v,
      type: "terminal-context",
      threadId,
      enabled: context.enabled,
      pending: context.pending,
    });
  }

  takeContext(threadId: string): TerminalContextSend | null {
    const send = this.context(threadId).take();
    if (send) {
      this.stopCapture(threadId);
      this.publishContext(threadId);
    }
    return send;
  }

  restoreContext(threadId: string, send: TerminalContextSend): void {
    // Deleted threads must not be resurrected by a late prompt rejection.
    this.contexts.get(threadId)?.restore(send);
    if (this.contexts.has(threadId)) this.publishContext(threadId);
  }

  forgetContext(threadId: string): void {
    if (this.contexts.delete(threadId))
      this.send({ v, type: "terminal-context", threadId, enabled: false, pending: false });
  }

  detachAll(): void {
    for (const session of this.sessions.values()) this.detach(session);
  }

  handle(message: TerminalRequest): void | Promise<void> {
    if (message.type === "terminal-sharing") {
      this.context(message.threadId).setEnabled(message.enabled);
      this.stopCapture(message.threadId);
      this.publishContext(message.threadId);
      return;
    }
    if (message.type === "terminal-discard") {
      this.context(message.threadId).discard();
      this.stopCapture(message.threadId);
      this.publishContext(message.threadId);
      return;
    }
    if (message.type === "terminal-preview") {
      this.send({
        v,
        type: "terminal-preview",
        threadId: message.threadId,
        ...this.context(message.threadId).preview(),
      });
      return;
    }
    if (message.type === "terminal-new") {
      if (this.stopping) throw new Error("Tondo is stopping its terminals.");
      const shells = [...this.sessions.values()].filter(
        (session) => session.threadId === message.threadId && !session.state.script,
      );
      if (shells.some((session) => session.state.kind === "login"))
        throw new Error("Close provider sign-in before opening another terminal.");
      if (shells.length >= MAX_SHELL_TERMINALS)
        throw new Error(
          `Close a terminal before starting another. Each thread can keep ${MAX_SHELL_TERMINALS} shells.`,
        );
      if (message.split) {
        const target = this.sessions.get(message.split.terminalId);
        if (!target || target.threadId !== message.threadId || target.state.kind === "login")
          throw new Error("The terminal to split is no longer available.");
      }
      return this.create(message.threadId, "shell", undefined, undefined, message.split);
    }
    if (message.type === "terminal-open")
      return this.open(message.threadId, message.kind, message.provider);
    const session = this.sessions.get(message.terminalId);
    // A late write, resize or cleanup must not reach a different terminal or thread.
    if (!session || session.threadId !== message.threadId) return;
    switch (message.type) {
      case "terminal-close":
        return this.closeSession(session);
      case "terminal-attach": {
        this.detach(session);
        session.attachment = message.attachment;
        if (!session.exited) {
          this.context(session.threadId).resize(session.state.id);
          session.pty?.resize(message.cols, message.rows);
        }
        this.enqueue(session, session.history.tail(TERMINAL_HISTORY_BYTES));
        this.pump(session);
        break;
      }
      case "terminal-detach":
        if (session.attachment === message.attachment) this.detach(session);
        break;
      case "terminal-write":
        session.typer?.input(message.data);
        if (session.state.status === "running") {
          for (const char of message.data) {
            const plain = session.input.push(char);
            // Pasting multiline text into a line editor is not submitting it.
            // Escape-only terminal replies and focus reports are not user input.
            if (plain && !session.pasting) session.capturing = plain === "\r" || plain === "\n";
          }
          session.pty?.write(message.data);
        }
        break;
      case "terminal-resize":
        if (session.state.status === "running") {
          this.context(session.threadId).resize(session.state.id);
          session.pty?.resize(message.cols, message.rows);
        }
        break;
      case "terminal-ack":
        if (session.attachment === message.attachment) {
          session.inFlight.delete(message.sequence);
          this.pump(session);
        }
        break;
    }
  }

  private stopCapture(threadId: string): void {
    for (const session of this.sessions.values())
      if (session.threadId === threadId) session.capturing = false;
  }

  /** A reused terminal ignores `provider`: only a new pi can be typed into safely. An exited one is replaced. */
  private open(threadId: string, kind: TerminalKind, provider?: string): Promise<void> {
    if (this.stopping) throw new Error("Tondo is stopping its terminals.");
    const existing = this.primary(threadId);
    // An exited terminal runs nothing, so opening one replaces it.
    if (existing?.state.status === "exited")
      return this.closeSession(existing).then(() => this.open(threadId, kind, provider));
    if (existing) {
      if (existing.state.kind !== kind)
        throw new Error("Close this thread's terminal before opening a different one.");
      this.publish(existing);
      return existing.started;
    }
    return this.create(threadId, kind, provider);
  }

  private create(
    threadId: string,
    kind: TerminalKind,
    provider?: string,
    script?: { name: string; launch: () => Promise<TerminalLaunch> },
    split?: TerminalSplit,
  ): Promise<void> {
    const session: Session = {
      threadId,
      state: {
        id: randomUUID(),
        kind,
        ...(!script && kind === "shell"
          ? {
              number:
                1 +
                Math.max(
                  0,
                  ...[...this.sessions.values()]
                    .filter((item) => item.threadId === threadId)
                    .map((item) => item.state.number ?? 0),
                ),
            }
          : {}),
        status: "starting",
        error: null,
        exitCode: null,
        ...(script ? { script: { name: script.name, cwd: "" } } : {}),
      },
      history: new TerminalHistory(),
      input: new HistoryFilter(true, (sequence) => {
        if (sequence === "\u001b[200~") {
          session.pasting = true;
          session.capturing = false;
        } else if (sequence === "\u001b[201~") session.pasting = false;
      }),
      pasting: false,
      capturing: false,
      started: Promise.resolve(),
      attachment: null,
      pending: [],
      inFlight: new Map(),
      sequence: 0,
      paused: false,
      exited: false,
    };
    if (kind === "login" && provider !== undefined)
      session.typer = new LoginTyper(provider, (data) => session.pty?.write(data));
    this.sessions.set(session.state.id, session);
    if (kind === "shell" && !script) this.context(threadId).newShell(session.state.id);
    this.publish(session, split);
    session.started = this.start(session, script?.launch);
    return session.started;
  }

  private async start(
    session: Session,
    scriptLaunch?: () => Promise<TerminalLaunch>,
  ): Promise<void> {
    try {
      const launch = await (scriptLaunch
        ? scriptLaunch()
        : this.launch(session.threadId, session.state.kind));
      if (session.state.script)
        session.state = { ...session.state, script: { ...session.state.script, cwd: launch.cwd } };
      const { spawn } = await (this.adapter ??= import("node-pty"));
      // node-pty doesn't throw for a missing cwd: the shell starts and exits with code 1.
      const folder = await stat(launch.cwd).then(
        (found) => found.isDirectory(),
        () => false,
      );
      if (session.state.status === "closing") return;
      if (!folder)
        throw new Error(`Couldn't start the terminal: the folder ${launch.cwd} no longer exists.`);
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
        session.typer?.output(data);
        if (
          session.state.kind === "shell" &&
          !session.state.script &&
          this.sessions.get(session.state.id) === session
        ) {
          const context = this.context(session.threadId);
          const pending = context.pending;
          context.append(data, session.capturing, session.state.id);
          // Only availability changes reach React, never the output stream.
          if (pending !== context.pending) this.publishContext(session.threadId);
        }
        if (session.attachment !== null) {
          this.enqueue(session, data);
          this.pump(session);
        }
      });
      pty.onExit(({ exitCode }) => {
        session.exited = true;
        session.typer?.stop();
        session.state = { ...session.state, status: "exited", exitCode };
        // A shell can leave children in its group when it exits on its own.
        void this.cleanup(session).catch((error: unknown) => this.problem(session, error));
        this.publish(session);
        if (!this.stopping) this.ended?.(session.threadId, session.state.kind);
      });
      session.state = { ...session.state, status: "running" };
      this.publish(session);
    } catch (error) {
      this.problem(session, error);
    }
  }

  async closeAll(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.sessions.values()].map((session) => this.closeSession(session)));
  }

  async close(threadId: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.threadId === threadId)
        .map((session) => this.closeSession(session)),
    );
  }

  private async closeSession(session: Session): Promise<void> {
    const { threadId } = session;
    session.state = { ...session.state, status: "closing" };
    session.typer?.stop();
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
    if (this.sessions.get(session.state.id) === session) {
      this.sessions.delete(session.state.id);
      this.contexts.get(threadId)?.forgetShell(session.state.id);
      this.send({
        v,
        type: "terminal-state",
        threadId,
        terminal: null,
        terminalId: session.state.id,
      });
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

  private publish(session: Session, split?: TerminalSplit): void {
    // node-pty can deliver an exit after close removed or replaced this session.
    if (this.sessions.get(session.state.id) !== session) return;
    this.send({
      v,
      type: "terminal-state",
      threadId: session.threadId,
      terminal: session.state,
      ...(split ? { split } : {}),
    });
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
