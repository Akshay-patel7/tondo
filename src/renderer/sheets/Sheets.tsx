// Panels that slash commands open over the window: /session, /trust and
// /hotkeys. Each is a ui Dialog, so it closes with Escape, a click
// outside or its close button, and focus goes back where it was.
import { useRef, type ReactNode } from "react";
import type { SessionInfo, TrustInfo } from "../../shared/protocol";
import { SHORTCUT_COMMANDS, SHORTCUT_TITLES } from "../../shared/settings";
import { answerTrust, revealFile } from "../connection";
import { formatPercent, formatTokens } from "../format";
import { isMac } from "../platform";
import { shortcutLabel, shortcutLabelFor } from "../shortcuts";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { closeSheet, useSheet, type OpenSheet } from "./store";

export function Sheets() {
  const sheet = useSheet((state) => state.sheet);
  const open = useSheet((state) => state.open);
  const id = useSheet((state) => state.id);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      {sheet === null ? null : <SheetFor key={id} sheet={sheet} />}
    </Dialog>
  );
}

function SheetFor({ sheet }: { sheet: OpenSheet }) {
  switch (sheet.kind) {
    case "session":
      return <SessionSheet info={sheet.info} />;
    case "trust":
      return <TrustSheet project={sheet.project} trust={sheet.trust} />;
    case "hotkeys":
      return <HotkeysSheet />;
  }
}

/**
 * A modal panel with a title, and buttons under it if it has any. It opens
 * with the panel itself focused, so Enter can't answer a question you haven't
 * read yet.
 */
function Sheet({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  return (
    <DialogPopup ref={panel} initialFocus={panel} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div>{children}</div>
      {footer}
    </DialogPopup>
  );
}

/** A heading and the rows under it. */
function Rows({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="not-first:mt-5">
      <h3 className="text-xs font-medium text-muted-foreground">{heading}</h3>
      {/* 8rem holds the widest keys, "Enter or 1 to 9", so every section's text starts in line. */}
      <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
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
      {/* A 20px line, like the label beside it, so their first lines share a baseline. */}
      <span className="min-w-0 flex-1 font-mono text-xs/5 break-all">{path}</span>
      <Button variant="link" size="xs" className="-my-0.5" onClick={() => revealFile(path)}>
        {REVEAL}
      </Button>
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
          <span className="font-mono text-xs/5">{info.id}</span>
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

/** /trust: who decides whether pi trusts the project, and your answer when it's Tondo's. */
function TrustSheet({ project, trust }: { project: string; trust: TrustInfo }) {
  const asked = trust.decidedBy === "tondo";
  return (
    <Sheet
      title="Project trust"
      footer={
        asked ? (
          <DialogFooter>
            <Button
              variant="outline"
              aria-pressed={trust.trusted === false}
              onClick={() => answerFromSheet(false)}
            >
              Don't trust
            </Button>
            <Button aria-pressed={trust.trusted === true} onClick={() => answerFromSheet(true)}>
              Trust
            </Button>
          </DialogFooter>
        ) : null
      }
    >
      <p className="font-mono text-xs break-all text-muted-foreground">{project}</p>
      <p className="mt-3">{trustText(trust)}</p>
      {asked ? (
        <p className="mt-2 text-muted-foreground">
          Trusting it lets pi load the project's .pi settings and resources and run its extensions.
          Changing your answer restarts pi.
        </p>
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

/** A fixed shortcut with this platform's modifier: ⌘1 on macOS, Ctrl+1 elsewhere. */
function mod(key: string): string {
  return shortcutLabel(key, isMac);
}

/**
 * /hotkeys: Tondo's shortcuts as your settings bind them, and the fixed keys in
 * the composer and in dialogs. Each opening is a fresh mount (Sheets keys it),
 * so a shortcut you changed since shows its new keys.
 */
function HotkeysSheet() {
  return (
    <Sheet title="Keyboard shortcuts">
      <Rows heading="Anywhere">
        {SHORTCUT_COMMANDS.map((command) => {
          const keys = shortcutLabelFor(command, isMac);
          return (
            <Row key={command} label={keys === null ? "None" : <Kbd>{keys}</Kbd>}>
              {SHORTCUT_TITLES[command]}
            </Row>
          );
        })}
        <Row
          label={
            <>
              <Kbd>{mod("1")}</Kbd> to <Kbd>{mod("9")}</Kbd>
            </>
          }
        >
          The sidebar's first nine threads
        </Row>
      </Rows>
      <Rows heading="Composer">
        <Row label={<Kbd>{isMac ? "Return" : "Enter"}</Kbd>}>Send, or steer pi while it works</Row>
        <Row label={<Kbd>{isMac ? "Option+Return" : "Alt+Enter"}</Kbd>}>Queue a follow-up</Row>
        <Row label={<Kbd>{isMac ? "Option+Up" : "Alt+Up"}</Kbd>}>
          Take queued messages back to edit
        </Row>
        <Row label={<Kbd>Escape</Kbd>}>Stop pi</Row>
        <Row label={<Kbd>{isMac ? "Shift+Return" : "Shift+Enter"}</Kbd>}>New line</Row>
        <Row label={<Kbd>/</Kbd>}>Slash commands: Tab completes one, Enter runs it</Row>
      </Rows>
      <Rows heading="Extension dialogs">
        <Row
          label={
            <>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd>
            </>
          }
        >
          Move
        </Row>
        <Row
          label={
            <>
              <Kbd>Enter</Kbd> or <Kbd>1</Kbd> to <Kbd>9</Kbd>
            </>
          }
        >
          Pick or submit
        </Row>
        <Row label={<Kbd>Escape</Kbd>}>Cancel</Row>
      </Rows>
    </Sheet>
  );
}
