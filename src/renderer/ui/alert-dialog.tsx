import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

// className is a string: cn can't merge Base UI's state callback.
type AlertDialogTriggerProps = Omit<
  ComponentProps<typeof AlertDialogPrimitive.Trigger>,
  "className"
> & { className?: string };
type AlertDialogPopupProps = Omit<
  ComponentProps<typeof AlertDialogPrimitive.Popup>,
  "className"
> & {
  className?: string;
};
type AlertDialogTitleProps = Omit<
  ComponentProps<typeof AlertDialogPrimitive.Title>,
  "className"
> & {
  className?: string;
};
type AlertDialogDescriptionProps = Omit<
  ComponentProps<typeof AlertDialogPrimitive.Description>,
  "className"
> & { className?: string };
type AlertDialogCloseProps = Omit<
  ComponentProps<typeof AlertDialogPrimitive.Close>,
  "className"
> & {
  className?: string;
};
type AlertDialogCancelProps = Omit<AlertDialogCloseProps, "render"> &
  Pick<ComponentProps<typeof Button>, "variant" | "size">;

/** A dialog that waits for an answer: a press outside doesn't close it, Escape does. */
const AlertDialog = AlertDialogPrimitive.Root;

// The header is the window's drag region. A trigger there has to opt out, or a
// click on it starts a window drag.
function AlertDialogTrigger({ className, ...props }: AlertDialogTriggerProps) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

/**
 * The question, over a flat backdrop, in a portal at the end of the body. Focus
 * moves to its first button when it opens, stays inside while it's open, and
 * goes back to the trigger when it closes. initialFocus and finalFocus change where.
 */
function AlertDialogPopup({ className, ...props }: AlertDialogPopupProps) {
  return (
    <AlertDialogPrimitive.Portal>
      {/* The backdrop covers the header too, so it mustn't be a window drag region. */}
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-backdrop"
        className="app-no-drag fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      {/* Centered by flex rather than a -50% translate, which can put text on half pixels. */}
      <AlertDialogPrimitive.Viewport
        data-slot="alert-dialog-viewport"
        className="app-no-drag fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <AlertDialogPrimitive.Popup
          data-slot="alert-dialog-popup"
          className={cn(
            "app-no-drag relative flex max-h-full w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-card border border-border bg-popover p-5 text-sm text-popover-foreground shadow-composer outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-title font-semibold", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogClose({ className, ...props }: AlertDialogCloseProps) {
  return (
    <AlertDialogPrimitive.Close data-slot="alert-dialog-close" className={className} {...props} />
  );
}

/**
 * The answer that does the thing. It doesn't close the dialog, so work that can
 * fail can keep it open: close it through `open` when the work is done.
 */
function AlertDialogAction(props: ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" {...props} />;
}

function AlertDialogCancel({ variant = "outline", size, ...props }: AlertDialogCancelProps) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogClose,
  AlertDialogPopup as AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
};
