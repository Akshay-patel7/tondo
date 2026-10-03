// Drawer resizing follows ThreadTerminalDrawer.tsx in T3 Code at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import {
  RENDERER_HISTORY_BYTES,
  type TerminalEvent,
  type TerminalState,
} from "../../shared/terminal";
import { reloadPi, terminalCommand, useHost } from "../connection";
import { readTerminal } from "./store";

function clampHeight(height: number): number {
  return Math.max(160, Math.min(height, window.innerHeight * 0.65));
}

function statusLabel(session: TerminalState): string {
  if (session.status === "running") return "";
  if (session.status === "exited")
    return session.exitCode === null ? "Exited" : `Exited (${session.exitCode})`;
  return session.status === "starting" ? "Starting…" : "Closing…";
}

export default function TerminalDrawer({
  threadId,
  session,
}: {
  threadId: string;
  session: TerminalState;
}) {
  const [height, setHeight] = useState(280);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const project = useHost((host) => host.thread?.project);
  const pi = useHost((host) => host.thread?.pi);
  const busy = useHost((host) =>
    host.projects.some((p) =>
      p.threads.some(
        (t) => t.id === threadId && (t.activity === "working" || t.activity === "waiting"),
      ),
    ),
  );
  useEffect(() => {
    const resize = () => setHeight((current) => clampHeight(current));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <section
      aria-label="Terminal"
      className="relative flex shrink-0 flex-col border-t border-border bg-panel"
      style={{ height }}
    >
      <div
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(height)}
        aria-valuemin={160}
        aria-valuemax={Math.round(window.innerHeight * 0.65)}
        tabIndex={0}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize focus:bg-primary/30"
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setHeight((current) => clampHeight(current + (event.key === "ArrowUp" ? 32 : -32)));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setHeight(clampHeight(drag.current.height + drag.current.y - event.clientY));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className="flex h-9 shrink-0 items-center gap-3 px-4 text-xs">
        <h2 className="font-medium">
          {session.kind === "login" ? "Provider sign-in" : "Terminal"}
        </h2>
        <span className="min-w-0 truncate text-muted-foreground" title={project}>
          {project}
        </span>
        <span className="ml-auto text-muted-foreground" role="status">
          {statusLabel(session)}
        </span>
        <button
          type="button"
          aria-label="Close terminal"
          title="Stop this terminal and its commands"
          disabled={session.status === "closing"}
          className="rounded-control px-2 py-1 hover:bg-accent disabled:opacity-50"
          onClick={() =>
            terminalCommand({ type: "terminal-close", threadId, terminalId: session.id })
          }
        >
          Close
        </button>
      </div>
      {session.kind === "login" ? (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2 text-xs text-muted-foreground">
          <span>
            Run /login or /logout here. Then refresh this thread's models. Other open threads need
            /reload too.
          </span>
          <button
            type="button"
            className="shrink-0 rounded-control border border-border px-2 py-1 disabled:opacity-50"
            disabled={pi?.state !== "ready" || busy}
            onClick={reloadPi}
          >
            Refresh models
          </button>
        </div>
      ) : null}
      {session.error ? (
        <p role="alert" className="px-4 text-sm text-destructive">
          {session.error}
        </p>
      ) : null}
      {session.status !== "starting" ? (
        <TerminalView threadId={threadId} terminalId={session.id} />
      ) : null}
    </section>
  );
}

function TerminalView({ threadId, terminalId }: { threadId: string; terminalId: string }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const attachment = crypto.randomUUID();
    let disposed = false;
    let writing = false;
    const queue: Extract<TerminalEvent, { type: "terminal-output" }>[] = [];
    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      scrollback: 1_000,
      screenReaderMode: true,
      allowProposedApi: false,
      theme: {
        background: "#20201e",
        foreground: "#eeece6",
        cursor: "#d49374",
        selectionBackground: "#655044",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let webgl: WebglAddon | undefined;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = undefined;
        element.dataset.renderer = "dom";
      });
      terminal.loadAddon(webgl);
      element.dataset.renderer = "webgl";
    } catch (error) {
      webgl?.dispose();
      webgl = undefined;
      element.dataset.renderer = "dom";
      console.warn("WebGL terminal unavailable; using xterm's DOM renderer.", error);
    }
    const resize = () => {
      if (disposed || element.clientWidth === 0 || element.clientHeight === 0) return;
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      const cols = Math.min(500, Math.max(2, dimensions.cols));
      const rows = Math.min(200, Math.max(1, dimensions.rows));
      // Bound retained text even for wide windows and four-byte characters.
      terminal.options.scrollback = Math.max(
        0,
        Math.floor(RENDERER_HISTORY_BYTES / (cols * 4)) - rows,
      );
      if (terminal.cols !== cols || terminal.rows !== rows) terminal.resize(cols, rows);
    };
    resize();
    const input = terminal.onData((data) => {
      if (disposed) return;
      for (let start = 0; start < data.length;) {
        let end = Math.min(start + 16_384, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
        terminalCommand({
          type: "terminal-write",
          threadId,
          terminalId,
          data: data.slice(start, end),
        });
        start = end;
      }
    });
    const resized = terminal.onResize(({ cols, rows }) =>
      terminalCommand({ type: "terminal-resize", threadId, terminalId, cols, rows }),
    );
    const write = () => {
      if (disposed || writing) return;
      const message = queue.shift();
      if (!message) return;
      writing = true;
      terminal.write(message.data, () => {
        if (disposed) return;
        writing = false;
        terminalCommand({
          type: "terminal-ack",
          threadId,
          terminalId,
          attachment,
          sequence: message.sequence,
        });
        write();
      });
    };
    const unread = readTerminal(attachment, (message) => {
      queue.push(message);
      write();
    });
    terminalCommand({
      type: "terminal-attach",
      threadId,
      terminalId,
      attachment,
      cols: terminal.cols,
      rows: terminal.rows,
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    terminal.focus();
    return () => {
      disposed = true;
      unread();
      observer.disconnect();
      input.dispose();
      resized.dispose();
      terminal.dispose();
      queue.length = 0;
      terminalCommand({ type: "terminal-detach", threadId, terminalId, attachment });
    };
  }, [threadId, terminalId]);
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-[#20201e] p-2">
      {/* FitAddon measures this parent's full size, so its padding stays outside. */}
      <div ref={mount} data-terminal-view className="h-full w-full" />
    </div>
  );
}
