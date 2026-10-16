// Drawer resizing follows ThreadTerminalDrawer.tsx in T3 Code at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { RefreshCw, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import {
  TERMINAL_HISTORY_BYTES,
  TERMINAL_HISTORY_LINES,
  type TerminalEvent,
  type TerminalState,
} from "../../shared/terminal";
import { reloadPi, terminalCommand, useHost } from "../connection";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { readTerminal } from "./store";
import { GraphemeUnicode } from "./unicode";

type ThemeColor = Exclude<keyof ITheme, "extendedAnsi">;

// xterm takes colors, not classes, so the theme names the tokens in index.css
// and terminalTheme resolves them. The terminal sits on the page's background
// in its text color, like the drawer around it. Magenta and cyan have no
// token: they turn info's and addition's lightness and chroma to their own
// hue. light-dark() keeps black dark and white pale in both themes, as
// programs expect. --accent is a translucent wash, so black takes --secondary,
// the opaque step above the page.
const TERMINAL_COLORS: Partial<Record<ThemeColor, string>> = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  cursor: "var(--primary)",
  cursorAccent: "var(--primary-foreground)",
  selectionBackground: "color-mix(in oklab, var(--primary) 30%, transparent)",
  black: "light-dark(var(--foreground), var(--secondary))",
  red: "var(--deletion)",
  green: "var(--addition)",
  yellow: "var(--warning)",
  blue: "var(--info)",
  magenta: "oklch(from var(--info) l c 320)",
  cyan: "oklch(from var(--addition) l c 195)",
  white: "light-dark(var(--muted-foreground), var(--card-foreground))",
  brightBlack: "var(--muted-foreground)",
  brightRed: "var(--deletion)",
  brightGreen: "var(--addition)",
  brightYellow: "var(--warning)",
  brightBlue: "var(--info)",
  brightMagenta: "oklch(from var(--info) l c 320)",
  brightCyan: "oklch(from var(--addition) l c 195)",
  brightWhite: "light-dark(var(--control-border), var(--accent-foreground))",
};

/**
 * TERMINAL_COLORS as hex. CSS computes each color, then a canvas converts it
 * to sRGB, as terminalThemeFromApp does in T3 Code's ThreadTerminalDrawer.tsx.
 */
function terminalTheme(): ITheme {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const theme: ITheme = {};
  for (const [name, color] of Object.entries(TERMINAL_COLORS) as [ThemeColor, string][]) {
    probe.style.color = color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const rgba = context.getImageData(0, 0, 1, 1).data;
    const bytes = rgba[3] === 255 ? rgba.subarray(0, 3) : rgba;
    theme[name] = `#${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  probe.remove();
  return theme;
}

// Programs such as pi's own interface pick colors for a dark background unless
// told otherwise. On the light theme xterm darkens any text below 4.5:1.
function minimumContrast(dark: MediaQueryList): number {
  return dark.matches ? 1 : 4.5;
}

const MIN_HEIGHT = 160;
// What a tall shell drawer leaves the thread's transcript, above the footer.
const MIN_TRANSCRIPT = 120;

function clampHeight(height: number, max: number): number {
  return Math.max(MIN_HEIGHT, Math.min(height, max));
}

/**
 * The tallest the drawer may be: 65% of the window and, for a shell, short
 * enough that the footer before it keeps its full height and the transcript
 * keeps MIN_TRANSCRIPT. A sign-in drawer needs its rows for pi's provider list
 * more than the thread needs its transcript, so it only takes the window cap.
 */
function maxHeight(region: HTMLElement, kind: TerminalState["kind"]): number {
  const cap = window.innerHeight * 0.65;
  const column = region.parentElement;
  const footer = region.previousElementSibling;
  if (kind === "login" || !column || !footer) return cap;
  const style = getComputedStyle(footer);
  let needed = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  for (const child of Array.from(footer.children)) needed += child.getBoundingClientRect().height;
  return Math.min(cap, column.clientHeight - needed - MIN_TRANSCRIPT);
}

// pi's /login provider list needs up to 20 terminal rows: a 17-row selector
// (borders, title, search box, eight providers, a count line and blank lines)
// above pi's two- or three-line footer. A sign-in drawer opens with room for
// 24, so footer and status lines that wrap still fit, unless clampHeight caps it.
const LOGIN_ROWS = 24;
// At fontSize 13 an xterm cell is 15px on macOS. 16 covers fonts whose cells
// are a little taller.
const ROW_HEIGHT = 16;
// Around the rows: the top border, the h-9 header, the hint wrapped to two
// text-xs lines over pb-2, and the terminal's p-2 above and below.
const LOGIN_CHROME = 1 + 36 + (2 * 16 + 8) + 2 * 8;

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
  const [height, setHeight] = useState(() =>
    session.kind === "login"
      ? clampHeight(LOGIN_CHROME + LOGIN_ROWS * ROW_HEIGHT, window.innerHeight * 0.65)
      : 280,
  );
  const [max, setMax] = useState(() => window.innerHeight * 0.65);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const opener = useRef<Element | null>(null);
  const region = useRef<HTMLElement>(null);
  const project = useHost((host) => host.thread?.project);
  const pi = useHost((host) => host.thread?.pi);
  const busy = useHost((host) =>
    host.projects.some((p) =>
      p.threads.some(
        (t) => t.id === threadId && (t.activity === "working" || t.activity === "waiting"),
      ),
    ),
  );
  // Close gives focus back to whatever had it when the drawer opened: the
  // Terminal button, or the composer that ran /login.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const element = region.current;
    // The palette's Close terminal or a thread switch can remove the drawer
    // while it has focus. This cleanup runs before React removes the drawer, so
    // it still sees that focus. The opener or composer may be swapped in the
    // same commit, so focus moves once the commit is done.
    return () => {
      if (!element?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return;
        const target =
          opener.current instanceof HTMLElement && opener.current.isConnected
            ? opener.current
            : document.querySelector<HTMLElement>('[role="textbox"][aria-label="Message"]');
        target?.focus();
      });
    };
  }, []);
  // The column follows the window, and the footer's content grows with
  // banners or a narrower column, so either change moves the cap.
  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = maxHeight(element, session.kind);
      setMax(next);
      setHeight((current) => clampHeight(current, next));
    });
    if (element.parentElement) observer.observe(element.parentElement);
    for (const child of Array.from(element.previousElementSibling?.children ?? []))
      observer.observe(child);
    return () => observer.disconnect();
  }, [session.kind]);
  const status = statusLabel(session);
  const failed = session.status === "exited" && session.exitCode !== null && session.exitCode !== 0;
  const close = () => {
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    terminalCommand({ type: "terminal-close", threadId, terminalId: session.id });
  };
  return (
    <section
      ref={region}
      aria-label="Terminal"
      className="relative flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
    >
      <div
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(height)}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={Math.round(Math.max(MIN_HEIGHT, max))}
        tabIndex={0}
        className="group absolute inset-x-0 -top-1 z-10 flex h-2 cursor-row-resize items-center justify-center focus-visible:focus-ring"
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setHeight((current) => clampHeight(current + (event.key === "ArrowUp" ? 32 : -32), max));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setHeight(clampHeight(drag.current.height + drag.current.y - event.clientY, max));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span
          aria-hidden
          className="h-1 w-8 rounded-full bg-control-border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 ps-4 pe-2">
        <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="shrink-0 font-medium">
          {session.kind === "login" ? "Provider sign-in" : "Terminal"}
        </h2>
        <span className="min-w-0 truncate font-mono text-xs text-faint-foreground" title={project}>
          {project}
        </span>
        <span role="status" className="ml-auto flex shrink-0 items-center">
          {status ? <Badge variant={failed ? "destructive" : "secondary"}>{status}</Badge> : null}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="faint-ghost"
                size="icon"
                aria-label="Close terminal"
                disabled={session.status === "closing"}
                onClick={close}
              />
            }
          >
            <X aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Stop this terminal and its commands</TooltipContent>
        </Tooltip>
      </div>
      {session.kind === "login" ? (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            Run /login or /logout here. Then refresh this thread's models. Other open threads need
            /reload too.
          </span>
          <Button
            variant="neutral"
            size="sm"
            disabled={pi?.state !== "ready" || busy}
            onClick={reloadPi}
          >
            <RefreshCw aria-hidden />
            Refresh models
          </Button>
        </div>
      ) : null}
      {session.error ? (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive">
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
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      scrollback: TERMINAL_HISTORY_LINES,
      screenReaderMode: true,
      // For terminal.unicode, which takes Tondo's grapheme widths.
      allowProposedApi: true,
      theme: terminalTheme(),
      minimumContrastRatio: minimumContrast(dark),
    });
    terminal.unicode.register(new GraphemeUnicode());
    terminal.unicode.activeVersion = "tondo-graphemes";
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // In screen reader mode xterm drops text inserted without a keydown: the
    // emoji picker, dictation and the Character Viewer. Typed keys arrive with
    // a keydown that xterm has already sent, so only the rest is forwarded.
    const textarea = terminal.textarea!;
    let keyDown = false;
    const pressed = () => {
      keyDown = true;
    };
    const released = () => {
      keyDown = false;
    };
    const inserted = (event: Event) => {
      if (!(event instanceof InputEvent) || event.inputType !== "insertText") return;
      if (event.data && !keyDown && !event.isComposing) terminal.input(event.data);
    };
    textarea.addEventListener("keydown", pressed);
    textarea.addEventListener("keyup", released);
    textarea.addEventListener("input", inserted);
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
    const retheme = () => {
      terminal.options.theme = terminalTheme();
      terminal.options.minimumContrastRatio = minimumContrast(dark);
    };
    dark.addEventListener("change", retheme);
    // A palette changes the colors without the scheme. App.tsx sets it on <html>.
    const palette = new MutationObserver(retheme);
    palette.observe(document.documentElement, { attributeFilter: ["data-palette"] });
    const resize = () => {
      if (disposed || element.clientWidth === 0 || element.clientHeight === 0) return;
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      const cols = Math.min(500, Math.max(2, dimensions.cols));
      const rows = Math.min(200, Math.max(1, dimensions.rows));
      // Bound retained text even for wide windows and four-byte characters.
      terminal.options.scrollback = Math.max(
        0,
        Math.min(TERMINAL_HISTORY_LINES, Math.floor(TERMINAL_HISTORY_BYTES / (cols * 4))) - rows,
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
      dark.removeEventListener("change", retheme);
      palette.disconnect();
      textarea.removeEventListener("keydown", pressed);
      textarea.removeEventListener("keyup", released);
      textarea.removeEventListener("input", inserted);
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
    <div className="min-h-0 flex-1 overflow-hidden bg-background p-2">
      {/* FitAddon measures this parent's full size, so its padding stays outside. */}
      <div ref={mount} data-terminal-view className="h-full w-full" />
    </div>
  );
}
