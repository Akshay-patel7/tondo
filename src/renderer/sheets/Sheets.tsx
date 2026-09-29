// Panels that slash commands open over the window: /session, /settings,
// /trust and /hotkeys. They look like the command palette and close with
// Escape, a click outside or their close button.
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { SessionInfo, SettingsFile, TrustInfo } from "../../shared/protocol";
import { answerTrust, revealFile } from "../connection";
import { formatPercent, formatTokens } from "../format";
import { isMac } from "../platform";
import { shortcutLabel } from "../shortcuts";
import { CrossIcon } from "../ui/icons";
import { closeSheet, useSheet } from "./store";

export function Sheets() {
  const sheet = useSheet((open) => open);
  if (!sheet) return null;
  switch (sheet.kind) {
    case "session":
      return <SessionSheet info={sheet.info} />;
    case "settings":
      return <SettingsSheet files={sheet.files} />;
    case "trust":
      return <TrustSheet project={sheet.project} trust={sheet.trust} />;
    case "hotkeys":
      return <HotkeysSheet />;
  }
}

/** A modal panel. Focus stays inside it until it closes, then goes back where it was. */
function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const buttons = [...(panel.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <>
      <div className="app-no-drag fixed inset-0 z-40 bg-black/20" onPointerDown={closeSheet} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="app-no-drag fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-composer"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border py-2 pr-2 pl-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-medium">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={closeSheet}
            className="flex size-7 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CrossIcon />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4 text-sm">{children}</div>
      </div>
    </>
  );
}

/** A heading and the rows under it. */
function Rows({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="not-first:mt-4">
      <h3 className="text-xs font-medium text-muted-foreground">{heading}</h3>
      <dl className="mt-1.5 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
        {children}
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const REVEAL = isMac ? "Show in Finder" : "Show in folder";

/** A file's path, and a button that shows it in Finder. */
function FilePath({ path }: { path: string }) {
  return (
    <span className="flex items-start gap-2">
      <span className="min-w-0 flex-1 font-mono text-xs break-all">{path}</span>
      <button
        type="button"
        onClick={() => revealFile(path)}
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        {REVEAL}
      </button>
    </span>
  );
}

function count(value: number): string {
  return value.toLocaleString("en");
}

/**
 * /session: the file, messages, tokens and cost pi's own /session shows. pi's
 * RPC stats leave out its cache warming and its costs per model.
 */
function SessionSheet({ info }: { info: SessionInfo }) {
  const { stats, context } = info;
  const { tokens } = stats;
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return (
    <Sheet title="Session">
      <Rows heading="Session">
        {info.name === null ? null : <Row label="Name">{info.name}</Row>}
        <Row label="File">{info.file ? <FilePath path={info.file} /> : "Not saved yet"}</Row>
        <Row label="ID">
          <span className="font-mono text-xs">{info.id}</span>
        </Row>
      </Rows>
      <Rows heading="Messages">
        <Row label="Total">{count(stats.totalMessages)}</Row>
        <Row label="Yours">{count(stats.userMessages)}</Row>
        <Row label="pi's">{count(stats.assistantMessages)}</Row>
        <Row label="Tools">
          {count(stats.toolCalls)} calls, {count(stats.toolResults)} results
        </Row>
      </Rows>
      <Rows heading="Tokens">
        <Row label="Input">{count(input)}</Row>
        {tokens.cacheRead > 0 ? (
          <Row label="From cache">
            {count(tokens.cacheRead)} ({formatPercent((tokens.cacheRead / input) * 100)})
          </Row>
        ) : null}
        <Row label="Output">{count(tokens.output)}</Row>
        <Row label="Total">{count(tokens.total)}</Row>
        {context !== null && context.tokens !== null && context.percent !== null ? (
          <Row label="Context">
            {formatTokens(context.tokens)} of {formatTokens(context.contextWindow)} (
            {formatPercent(context.percent)})
          </Row>
        ) : null}
        {stats.cost > 0 ? <Row label="Cost">${stats.cost.toFixed(3)}</Row> : null}
      </Rows>
    </Sheet>
  );
}

/** /settings: where pi's settings are. Tondo's own settings screen comes later. */
function SettingsSheet({ files }: { files: readonly SettingsFile[] }) {
  return (
    <Sheet title="Settings">
      <p className="text-muted-foreground">
        Tondo has no settings screen yet. pi reads its settings from these files, and the project's
        win over your global ones.
      </p>
      <Rows heading="pi's settings">
        {files.map((file) => (
          <Row key={file.scope} label={file.scope}>
            {file.exists ? (
              <FilePath path={file.path} />
            ) : (
              <span>
                <span className="font-mono text-xs break-all">{file.path}</span>
                <span className="text-muted-foreground"> doesn't exist yet</span>
              </span>
            )}
          </Row>
        ))}
      </Rows>
    </Sheet>
  );
}

/** /trust: who decides whether pi trusts the project, and your answer when it's Tondo's. */
function TrustSheet({ project, trust }: { project: string; trust: TrustInfo }) {
  return (
    <Sheet title="Project trust">
      <p className="font-mono text-xs break-all text-muted-foreground">{project}</p>
      <p className="mt-3">{trustText(trust)}</p>
      {trust.decidedBy === "tondo" ? (
        <>
          <p className="mt-2 text-muted-foreground">
            Trusting it lets pi load the project's .pi settings and resources and run its
            extensions. Changing your answer restarts pi.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              aria-pressed={trust.trusted === false}
              onClick={() => answerFromSheet(false)}
              className="rounded-control border border-border px-3 py-1.5 hover:bg-accent hover:text-accent-foreground aria-pressed:border-ring"
            >
              Don't trust
            </button>
            <button
              type="button"
              aria-pressed={trust.trusted === true}
              onClick={() => answerFromSheet(true)}
              className="rounded-control bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Trust
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/** Your new answer about trust, which restarts pi if it changed. */
function answerFromSheet(trusted: boolean): void {
  closeSheet();
  answerTrust(trusted);
}

function trustText(trust: TrustInfo): string {
  switch (trust.decidedBy) {
    case "nothing":
      return "The project has no .pi settings or resources, so there's nothing for pi to trust.";
    case "trust-file":
      return `pi's trust.json ${trust.trusted ? "trusts" : "doesn't trust"} ${trust.folder}, so pi decides by itself. Change it with /trust in pi's terminal UI.`;
    case "default":
      return `pi's defaultProjectTrust setting is "${trust.trusted ? "always" : "never"}", so pi decides by itself.`;
    case "tondo":
      if (trust.trusted === null) {
        return "pi would ask whether to trust this project, and Tondo answers for it.";
      }
      return `You told Tondo ${trust.trusted ? "to trust" : "not to trust"} this project.`;
  }
}

function Keys({ children }: { children: string }) {
  return <kbd className="font-sans whitespace-nowrap">{children}</kbd>;
}

/** A shortcut with this platform's modifier: ⌘K on macOS, Ctrl+K elsewhere. */
function mod(key: string, shift = false): string {
  return shortcutLabel(key, isMac, shift);
}

/** /hotkeys: Tondo's shortcuts, and the keys in the composer and in dialogs. */
function HotkeysSheet() {
  return (
    <Sheet title="Keyboard shortcuts">
      <Rows heading="Anywhere">
        <Row label={<Keys>{mod("K")}</Keys>}>Search threads, projects and actions</Row>
        <Row label={<Keys>{mod("N")}</Keys>}>New thread</Row>
        <Row label={<Keys>{mod("O")}</Keys>}>Add a project</Row>
        <Row label={<Keys>{mod("B")}</Keys>}>Show or hide the sidebar</Row>
        <Row label={<Keys>{`${mod("[", true)}  ${mod("]", true)}`}</Keys>}>
          Previous or next thread
        </Row>
        <Row label={<Keys>{`${mod("1")} to ${mod("9")}`}</Keys>}>
          The sidebar's first nine threads
        </Row>
      </Rows>
      <Rows heading="Composer">
        <Row label={<Keys>Enter</Keys>}>Send, or steer pi while it works</Row>
        <Row label={<Keys>Alt+Enter</Keys>}>Queue a follow-up</Row>
        <Row label={<Keys>Alt+Up</Keys>}>Take queued messages back to edit</Row>
        <Row label={<Keys>Escape</Keys>}>Stop pi</Row>
        <Row label={<Keys>Shift+Enter</Keys>}>New line</Row>
        <Row label={<Keys>/</Keys>}>Slash commands: Tab completes one, Enter runs it</Row>
      </Rows>
      <Rows heading="Extension dialogs">
        <Row label={<Keys>↑ ↓</Keys>}>Move</Row>
        <Row label={<Keys>Enter or 1 to 9</Keys>}>Pick or submit</Row>
        <Row label={<Keys>Escape</Keys>}>Cancel</Row>
      </Rows>
    </Sheet>
  );
}
