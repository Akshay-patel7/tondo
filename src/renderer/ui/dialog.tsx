import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

// className is a string: cn can't merge Base UI's state callback.
type DialogTriggerProps = Omit<ComponentProps<typeof DialogPrimitive.Trigger>, "className"> & {
  className?: string;
};
type DialogPopupProps = Omit<ComponentProps<typeof DialogPrimitive.Popup>, "className"> & {
  className?: string;
  showCloseButton?: boolean;
};
type DialogTitleProps = Omit<ComponentProps<typeof DialogPrimitive.Title>, "className"> & {
  className?: string;
};
type DialogDescriptionProps = Omit<
  ComponentProps<typeof DialogPrimitive.Description>,
  "className"
> & { className?: string };
type DialogCloseProps = Omit<ComponentProps<typeof DialogPrimitive.Close>, "className"> & {
  className?: string;
};

const Dialog = DialogPrimitive.Root;

// The header is the window's drag region. A trigger there has to opt out, or a
// click on it starts a window drag.
function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

/**
 * The dialog's panel, over a flat backdrop, in a portal at the end of the body.
 * Focus moves into it when it opens, stays inside while it's open, and goes
 * back to the trigger when it closes. initialFocus and finalFocus change where.
 */
function DialogPopup({ className, children, showCloseButton = true, ...props }: DialogPopupProps) {
  return (
    <DialogPrimitive.Portal>
      {/* The backdrop covers the header too, so a press there closes the dialog instead of dragging the window. */}
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="app-no-drag fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      {/* Centered by flex rather than a -50% translate, which can put text on half pixels. */}
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className="app-no-drag fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <DialogPrimitive.Popup
          data-slot="dialog-popup"
          className={cn(
            "app-no-drag relative flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-card border border-border bg-popover p-5 text-sm text-popover-foreground shadow-composer outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label="Close"
              className="absolute top-4 right-4"
              render={<Button variant="ghost" size="icon" />}
            >
              <X aria-hidden />
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

// The end padding keeps a long title clear of the close button.
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pe-8", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DialogClose({ className, ...props }: DialogCloseProps) {
  return <DialogPrimitive.Close data-slot="dialog-close" className={className} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogPopup as DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
};
