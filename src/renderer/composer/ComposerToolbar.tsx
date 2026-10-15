// The send and stop buttons follow T3 Code's
// apps/web/src/components/chat/ComposerPrimaryActions.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { ArrowUp, Paperclip, Plus, Square } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { PiStatus } from "../../shared/protocol";
import { chordLabel } from "../../shared/shortcuts";
import { isMac } from "../platform";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ContextMeter } from "./ContextMeter";
import { ModelPicker, ThinkingPicker } from "./SessionControls";

const ENTER = chordLabel({ key: "enter", mod: false, shift: false, alt: false }, isMac);

export interface AttachProps {
  readonly disabled?: boolean;
  readonly onFiles: (files: readonly File[]) => void;
  readonly localFiles?: { readonly disabled?: boolean; readonly onPick: () => void };
}

/** Image bytes use the page picker; local file paths use the native dialog. */
export function AttachButton({ disabled = false, onFiles, localFiles }: AttachProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        aria-label="Choose images"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          onFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Attach images"
              disabled={disabled}
              onClick={() => input.current?.click()}
            />
          }
        >
          <Plus aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Attach PNG, JPEG, GIF or WebP images</TooltipContent>
      </Tooltip>
      {localFiles ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Attach files"
                disabled={localFiles.disabled}
                onClick={localFiles.onPick}
              />
            }
          >
            <Paperclip aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Add original local file paths. Files are not copied.</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}

/** Send, 32px round: a wash while there's nothing to send, the primary fill once there is. */
export function SendButton({
  disabled,
  working = false,
  onClick,
}: {
  readonly disabled: boolean;
  /** pi is working, so the press steers it. */
  readonly working?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="send" aria-label="Send message" disabled={disabled} onClick={onClick} />
        }
      >
        <ArrowUp aria-hidden />
      </TooltipTrigger>
      <TooltipContent>
        {working ? "Steer pi" : "Send"} <Kbd>{ENTER}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Stop, 32px round in the text color with a 10px square. Escape does the same. */
export function StopButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="stop" aria-label="Stop pi" onClick={onClick} />}>
        <Square aria-hidden className="size-2.5 fill-current" />
      </TooltipTrigger>
      <TooltipContent>
        Stop pi <Kbd>Esc</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export interface ComposerToolbarProps {
  /** pi, whose session fills the pickers and the context ring once it's ready. */
  readonly pi: PiStatus;
  /** false leaves the context ring out: the Home screen has no conversation to measure yet. */
  readonly contextRing?: boolean;
  /** The Attach button. Without it, there is none. */
  readonly attach?: AttachProps;
  /** The primary action at the right end: Send, or Stop while pi works. */
  readonly children?: ReactNode;
}

/**
 * The row under the editor: Attach, the model and thinking pickers, then the
 * context ring and `children` on the right. Padding 0 8px 8px.
 */
export function ComposerToolbar({
  pi,
  contextRing = true,
  attach,
  children,
}: ComposerToolbarProps) {
  const session = pi.state === "ready" ? pi.session : null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
      {attach ? <AttachButton {...attach} /> : null}
      {session ? (
        <>
          <ModelPicker session={session} />
          <ThinkingPicker session={session} />
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {contextRing && session?.context ? <ContextMeter context={session.context} /> : null}
        {children}
      </div>
    </div>
  );
}
