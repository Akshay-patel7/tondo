// The send and stop buttons follow T3 Code's
// apps/web/src/components/chat/ComposerPrimaryActions.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useEffect, useId, useRef, useState } from "react";
import type { PiStatus, SlashCommand, StreamingBehavior } from "../../shared/protocol";
import { builtinIn } from "../../shared/slashCommands";
import { dequeue, editDraft, prompt, stop, usePi } from "../connection";
import { runBuiltin } from "../slash/builtins";
import { searchSlash, slashItems, slashQuery, type SlashItem } from "../slash/menu";
import { slashOptionId, SlashMenu } from "../slash/SlashMenu";
import { useThread } from "../thread/store";
import { ContextMeter } from "./ContextMeter";
import { useDraft } from "./draft";
import { promptHistory, stepHistory, type HistoryPosition } from "./history";
import { composerAction } from "./keys";
import { PromptEditor, type EditorSnapshot, type PromptEditorHandle } from "./PromptEditor";
import { ModelPicker, ThinkingPicker } from "./SessionControls";

const NO_COMMANDS: readonly SlashCommand[] = [];

function placeholder(pi: PiStatus, working: boolean): string {
  if (pi.state === "starting") return "Starting pi…";
  if (pi.state !== "ready") return "pi isn't running";
  return working
    ? "Steer pi with Enter, or queue a follow-up with Alt+Enter"
    : "Message pi, or type / for commands";
}

/**
 * Runs what you wrote: one of pi's built-in commands, which Tondo runs itself,
 * or a message for pi, if pi is there to take it.
 */
function submit(text: string, streamingBehavior: StreamingBehavior, pi: PiStatus): void {
  const message = text.trim();
  if (message === "") return;
  const builtin = builtinIn(message);
  if (!builtin && pi.state !== "ready") return;
  // Clearing first saves the empty draft ahead of the prompt, so the host
  // never keeps text you sent as the thread's draft. A built-in command
  // clears the composer too, as in pi's terminal UI.
  editDraft("");
  if (builtin) runBuiltin(builtin.name, builtin.args);
  else prompt(message, streamingBehavior);
}

/** `text` with the command it starts with replaced by `item`'s, and where the caret goes. */
function complete(text: string, caret: number, item: SlashItem): { text: string; caret: number } {
  const rest = text.slice(caret);
  const command = `/${item.name}`;
  return {
    text: `${command}${/^\s/.test(rest) ? rest : ` ${rest}`}`,
    caret: command.length + 1,
  };
}

/** `hidden` while an extension's dialog takes the composer's place. */
export function Composer({ hidden }: { hidden: boolean }) {
  const draft = useDraft((text) => text);
  const pi = usePi();
  const working = useThread((thread) => thread.running || thread.compaction !== null);
  const queued = useThread(
    (thread) => thread.queue.steering.length + thread.queue.followUp.length > 0,
  );
  const editor = useRef<PromptEditorHandle>(null);
  const history = useRef<HistoryPosition | null>(null);
  const menuId = useId();
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const caret = selection.from;
  const [highlighted, setHighlighted] = useState(0);
  /** The text you closed the menu on with Escape. It stays closed until the text changes. */
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const text = draft.trim();
  const canSend = text !== "" && (pi.state === "ready" || builtinIn(text) !== null);
  const commands = pi.state === "ready" ? pi.session.commands : NO_COMMANDS;
  const menuHidden = hidden || dismissedAt === draft || selection.from !== selection.to;
  const query = menuHidden ? null : slashQuery(draft, caret);
  const items = query === null ? [] : searchSlash(slashItems(commands), query);
  const current = Math.min(highlighted, items.length - 1);
  const picked = items[current];
  const activeOption = picked ? slashOptionId(menuId, current) : undefined;

  // The composer takes focus back when a dialog that took its place closes.
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden) editor.current?.focus();
    wasHidden.current = hidden;
  }, [hidden]);

  const send = (streamingBehavior: StreamingBehavior) => submit(draft, streamingBehavior, pi);

  /** Puts the picked command in the composer. With `run`, sends it too, as Enter does in pi's menu. */
  const pick = (item: SlashItem, run: boolean) => {
    const completed = complete(draft, caret, item);
    if (run) {
      submit(completed.text, "steer", pi);
      return;
    }
    setHighlighted(0);
    editor.current?.replace(completed.text, completed.caret);
  };

  const onKeyDown = (event: KeyboardEvent, snapshot: EditorSnapshot): boolean => {
    const { key, altKey, ctrlKey, metaKey, shiftKey, isComposing } = event;
    if (query !== null && !isComposing && !altKey && !ctrlKey && !metaKey) {
      // pi's menu keys: the arrows move, Tab completes, Enter completes and
      // sends, and Escape closes the menu before it would stop pi.
      if (key === "Escape") {
        event.preventDefault();
        setDismissedAt(draft);
        return true;
      }
      if (picked && !shiftKey && (key === "ArrowDown" || key === "ArrowUp")) {
        event.preventDefault();
        const step = key === "ArrowDown" ? 1 : -1;
        setHighlighted((current + step + items.length) % items.length);
        return true;
      }
      if (picked && !shiftKey && (key === "Tab" || key === "Enter")) {
        event.preventDefault();
        pick(picked, key === "Enter");
        return true;
      }
    }
    if (
      !isComposing &&
      !altKey &&
      !ctrlKey &&
      !metaKey &&
      !shiftKey &&
      snapshot.from === snapshot.to &&
      (key === "ArrowUp" || key === "ArrowDown")
    ) {
      const step = stepHistory(
        promptHistory(useThread.getState().messages),
        history.current,
        snapshot.text,
        key === "ArrowUp" ? "backward" : "forward",
      );
      if (step) {
        history.current = step.position;
        editor.current?.replace(step.text, step.text.length);
        return true;
      }
    }
    const press = { key, altKey, ctrlKey, metaKey, shiftKey, isComposing };
    const action = composerAction(press, { working, queued });
    if (action === null) return false;
    event.preventDefault();
    if (action === "send") send("steer");
    else if (action === "follow-up") send("followUp");
    else if (action === "stop") stop();
    else dequeue();
    return true;
  };

  return (
    <div
      hidden={hidden}
      className="rounded-panel border border-border bg-card shadow-composer focus-within:border-ring"
    >
      {query === null ? null : (
        <SlashMenu
          id={menuId}
          items={items}
          highlighted={current}
          onHighlight={setHighlighted}
          onPick={(item) => pick(item, true)}
        />
      )}
      <PromptEditor
        ref={editor}
        menuId={query !== null ? menuId : undefined}
        activeOption={activeOption}
        value={draft}
        onChange={(next) => {
          if (history.current?.text !== next) history.current = null;
          setHighlighted(0);
          editDraft(next);
        }}
        onSelection={({ from, to }) => setSelection({ from, to })}
        onKeyDown={onKeyDown}
        placeholder={placeholder(pi, working)}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        {pi.state === "ready" ? (
          <>
            <ModelPicker session={pi.session} />
            <ThinkingPicker session={pi.session} />
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {pi.state === "ready" && pi.session.context ? (
            <ContextMeter context={pi.session.context} />
          ) : null}
          {working ? (
            <button
              type="button"
              aria-label="Stop pi"
              title="Stop pi (Escape)"
              onClick={stop}
              className="flex size-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <svg viewBox="0 0 8 8" aria-hidden="true" className="size-2.5">
                <rect width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : null}
          {working && text === "" ? null : (
            <button
              type="button"
              aria-label="Send message"
              title={working ? "Steer pi (Enter)" : "Send (Enter)"}
              disabled={!canSend}
              onClick={() => send("steer")}
              className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
            >
              <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5">
                <path
                  d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
