// The question Streamdown asks before it opens a link from a reply, as a ui
// Dialog. Streamdown's own is a page-wide button with the question inside it:
// screen readers can't tell it's a dialog, and focus stays on the link behind it.
import { useRef, useState } from "react";
import type { LinkSafetyModalProps } from "streamdown";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/**
 * Asks before `url` opens in the browser. Focus moves to Cancel when it opens,
 * stays inside while it's open, and goes back to the link when it closes.
 * Streamdown renders one for every link, so it's on the page only from when it
 * opens until it has finished closing.
 */
export function LinkDialog({ url, isOpen, onClose, onConfirm }: LinkSafetyModalProps) {
  const [closing, setClosing] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  if (!isOpen && !closing) return null;

  const close = () => {
    setClosing(true);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setClosing(false);
      }}
    >
      {/* Base UI hides the page behind from screen readers. aria-modal tells them too. */}
      <DialogPopup aria-modal showCloseButton={false} initialFocus={cancel}>
        <DialogHeader>
          <DialogTitle>Open external link?</DialogTitle>
          {/* The address is part of the description, so a screen reader reads it out. */}
          <DialogDescription>
            This opens{" "}
            <span className="font-mono wrap-anywhere text-foreground select-text">{url}</span> in
            your browser.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose ref={cancel} render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            Open link
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
