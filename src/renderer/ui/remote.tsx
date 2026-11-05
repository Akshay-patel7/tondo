import { ArrowLeft, ArrowUp, FileDiff, Pin, Plus, Square } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type { ModelOption, PiSession, SidebarProject, ThinkingLevel } from "../../shared/protocol";
import { THINKING_LABELS } from "../../shared/settings";
import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

export function RemoteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="remote-shell flex min-h-0 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}

export function RemoteHeader({
  title,
  back,
  changes,
}: {
  title: string;
  back?: (() => void) | undefined;
  changes?: (() => void) | undefined;
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)]">
      {back ? (
        <Button variant="ghost" size="icon" className="size-11" onClick={back} aria-label="Threads">
          <ArrowLeft />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-muted-foreground">TONDO · REMOTE</p>
        <h1 className="truncate text-sm font-medium">{title}</h1>
      </div>
      {changes ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={changes}
          aria-label="View changes"
        >
          <FileDiff />
        </Button>
      ) : null}
    </header>
  );
}

export function RemoteNotice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      role={error ? "alert" : "status"}
      className={`shrink-0 px-4 py-2 text-sm break-words ${error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}

export function RemotePairForm({
  code,
  setCode,
  submit,
  busy,
}: {
  code: string;
  setCode: (code: string) => void;
  submit: (event: FormEvent) => void;
  busy: boolean;
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-medium">Your Mac, within reach.</h2>
          <p className="text-sm text-muted-foreground">
            Enter the pairing code from Tondo Settings → Remote access. Your iPhone and Mac must be
            connected to the same Tailscale network.
          </p>
        </div>
        <label htmlFor="pairing-code" className="text-sm font-medium">
          Pairing code
        </label>
        <Input
          id="pairing-code"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="min-h-11 text-base"
          required
        />
        <Button type="submit" disabled={busy || !code.trim()} className="min-h-11">
          {busy ? "Connecting…" : "Connect to Tondo"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your threads and agents stay on your Mac. It needs to remain awake, online and running
          Tondo.
        </p>
      </form>
    </main>
  );
}

export function RemoteThreadList({
  projects,
  choose,
  create,
  disabled,
}: {
  projects: readonly SidebarProject[];
  choose: (id: string) => void;
  create: (projectId: number) => void;
  disabled: boolean;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a project in Tondo on your Mac to get started.
          </p>
        ) : null}
        {projects.map((project) => (
          <section key={project.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                {project.path.split("/").at(-1)}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                disabled={disabled}
                onClick={() => create(project.id)}
                aria-label={`New thread in ${project.path.split("/").at(-1)}`}
              >
                <Plus />
              </Button>
            </div>
            <div className="overflow-hidden rounded-panel border border-border">
              {project.threads.map((thread) => (
                <button
                  key={thread.id}
                  data-thread-id={thread.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => choose(thread.id)}
                  className="flex min-h-16 w-full items-center gap-3 border-b border-border px-4 py-3 text-left outline-none last:border-0 hover:bg-muted focus-visible:focus-ring disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {thread.pinned ? (
                        <Pin
                          className="size-3.5 shrink-0 text-muted-foreground"
                          role="img"
                          aria-label="Pinned thread"
                        />
                      ) : null}
                      <p className="truncate text-sm font-medium">{thread.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {thread.archived ? "Archived · " : ""}
                      {thread.activity}
                    </p>
                  </div>
                  {thread.unread ? (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                  ) : null}
                </button>
              ))}
              {project.threads.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">No threads yet.</p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function modelKey(option: { provider: string; id: string }): string {
  return JSON.stringify([option.provider, option.id]);
}

export function RemoteSessionControls({
  session,
  disabled,
  model,
  thinking,
}: {
  session: PiSession;
  disabled: boolean;
  model: (option: ModelOption) => void;
  thinking: (level: ThinkingLevel) => void;
}) {
  const current = session.model ? modelKey(session.model) : "";
  const listed = session.models.some((option) => modelKey(option) === current);
  const selectClass =
    "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-base text-foreground outline-none focus-visible:focus-ring disabled:opacity-50";
  return (
    <div className="flex min-w-0 gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
        Model
        <select
          className={selectClass}
          value={current}
          disabled={disabled || session.models.length === 0}
          onChange={(event) => {
            const option = session.models.find((item) => modelKey(item) === event.target.value);
            if (option) model(option);
          }}
        >
          {!listed ? <option value={current}>{session.model?.id ?? "No model"}</option> : null}
          {session.models.map((option) => (
            <option key={modelKey(option)} value={modelKey(option)}>
              {option.name} · {option.provider}
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-32 shrink-0 flex-col gap-1 text-xs text-muted-foreground">
        Thinking
        <select
          className={selectClass}
          value={session.thinkingLevel}
          disabled={disabled || session.thinkingLevels.length < 2}
          onChange={(event) => {
            const level = session.thinkingLevels.find((item) => item === event.target.value);
            if (level) thinking(level);
          }}
        >
          {session.thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {level === "off" ? "Off" : THINKING_LABELS[level].replace(" thinking", "")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function RemoteComposer({
  text,
  setText,
  send,
  stop,
  disabled,
  busy,
  running,
  controls,
}: {
  controls?: ReactNode;
  text: string;
  setText: (text: string) => void;
  send: () => void;
  stop: () => void;
  disabled: boolean;
  busy: boolean;
  running: boolean;
}) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {controls}
      <label htmlFor="remote-message" className="sr-only">
        Message
      </label>
      <Textarea
        id="remote-message"
        placeholder={running ? "Steer the agent…" : "Message Tondo…"}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        className="max-h-36 min-h-20 resize-none text-base"
      />
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {busy ? "Waiting for your Mac…" : "Draft stays on this device · text only"}
        </p>
        {running ? (
          <Button
            type="button"
            variant="ghost"
            className="size-11"
            disabled={disabled}
            onClick={stop}
            aria-label="Stop agent"
          >
            <Square />
          </Button>
        ) : null}
        <Button
          type="submit"
          className="size-11"
          disabled={disabled || busy || !text.trim()}
          aria-label="Send message"
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}

export function RemoteFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="remote-footer max-h-[55dvh] shrink-0 overflow-y-auto border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {children}
    </footer>
  );
}
