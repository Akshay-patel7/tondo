import { useId, useState } from "react";
import { TERMINAL_CONTEXT_CHARS } from "../../shared/terminal";
import { terminalCommand } from "../connection";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { TerminalOutput } from "../ui/terminal-output";
import { useTerminalContexts } from "./store";

export function TerminalSharing({ threadId }: { threadId: string }) {
  const id = useId();
  const enabled = useTerminalContexts((contexts) => contexts.get(threadId)?.enabled ?? false);
  return (
    <Label
      htmlFor={id}
      className="shrink-0"
      title="Share output after submitting a terminal command with your next chat message. Output may contain secrets; preview it before sending."
    >
      <Switch
        id={id}
        size="sm"
        aria-label="Share terminal output with chat"
        checked={enabled}
        onCheckedChange={(checked) =>
          terminalCommand({ type: "terminal-sharing", threadId, enabled: checked })
        }
      />
      Share with chat
    </Label>
  );
}

export function TerminalAttachment({ threadId }: { threadId: string }) {
  const context = useTerminalContexts((contexts) => contexts.get(threadId));
  const [open, setOpen] = useState(false);
  if (!context?.enabled || !context.pending) return null;
  return (
    <div className="px-4 pt-3">
      <Alert role="group" aria-label="Pending terminal output">
        <AlertTitle>Terminal output attached</AlertTitle>
        <AlertDescription>
          New output will accompany your next chat message. Check for secrets before sending.
        </AlertDescription>
        <AlertAction>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) terminalCommand({ type: "terminal-preview", threadId });
            }}
          >
            <DialogTrigger render={<Button variant="ghost" size="sm" />}>Preview</DialogTrigger>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>Terminal output</DialogTitle>
                <DialogDescription>
                  A snapshot of the pending output. New output before you send is included too. Only
                  the latest {TERMINAL_CONTEXT_CHARS.toLocaleString("en-US")} characters are kept.
                  Slash commands don't send this attachment.
                </DialogDescription>
              </DialogHeader>
              {context.preview ? (
                <>
                  {context.preview.truncated ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        Earlier output was omitted because this log exceeded the limit.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <TerminalOutput aria-label="Captured terminal output">
                    {context.preview.text}
                  </TerminalOutput>
                </>
              ) : (
                <p role="status">Loading preview...</p>
              )}
            </DialogPopup>
          </Dialog>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Discard terminal output"
            onClick={() => terminalCommand({ type: "terminal-discard", threadId })}
          >
            Discard
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
