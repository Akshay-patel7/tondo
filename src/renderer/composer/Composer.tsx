// A plain textarea until Stage 8 brings TipTap. The send and stop buttons
// follow T3 Code's apps/web/src/components/chat/ComposerPrimaryActions.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { KeyboardEvent } from "react";
import type { PiStatus, StreamingBehavior } from "../../shared/protocol";
import { dequeue, prompt, stop, useHost } from "../connection";
import { useThread } from "../thread/store";
import { ContextMeter } from "./ContextMeter";
import { setDraft, useDraft } from "./draft";
import { composerAction } from "./keys";
import { ModelPicker, ThinkingPicker } from "./SessionControls";

function placeholder(pi: PiStatus, working: boolean): string {
  if (pi.state === "starting") return "Starting pi…";
  if (pi.state !== "ready") return "pi isn't running";
  return working ? "Steer pi with Enter, or queue a follow-up with Alt+Enter" : "Message pi";
}

export function Composer() {
  const draft = useDraft((text) => text);
  const pi = useHost((host) => host.workspace.pi);
  const working = useThread((thread) => thread.running || thread.compaction !== null);
  const queued = useThread(
    (thread) => thread.queue.steering.length + thread.queue.followUp.length > 0,
  );
  const text = draft.trim();
  const canSend = pi.state === "ready" && text !== "";

  const send = (streamingBehavior: StreamingBehavior) => {
    if (!canSend) return;
    prompt(text, streamingBehavior);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
    const press = {
      key,
      altKey,
      ctrlKey,
      metaKey,
      shiftKey,
      isComposing: event.nativeEvent.isComposing,
    };
    const action = composerAction(press, { working, queued });
    if (action === null) return;
    event.preventDefault();
    if (action === "send") send("steer");
    else if (action === "follow-up") send("followUp");
    else if (action === "stop") stop();
    else dequeue();
  };

  return (
    <div className="rounded-panel border border-border bg-card shadow-composer focus-within:border-ring">
      <textarea
        aria-label="Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={placeholder(pi, working)}
        className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 outline-none placeholder:text-muted-foreground"
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
