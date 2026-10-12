import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

// A panel floats 8px in from the window's edges and starts below the 40px title
// bar, where Windows and Linux draw the window buttons over the page.
const sheetVariants = cva(
  "app-no-drag fixed z-50 flex flex-col gap-4 overflow-y-auto rounded-card border border-border bg-popover p-5 text-sm text-popover-foreground shadow-composer outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
  {
    variants: {
      side: {
        right: "top-12 right-2 bottom-2 w-96 max-w-[calc(100%-1rem)] origin-right",
        left: "top-12 bottom-2 left-2 w-96 max-w-[calc(100%-1rem)] origin-left",
        top: "inset-x-2 top-12 max-h-[calc(100%-3.5rem)] origin-top",
        bottom: "inset-x-2 bottom-2 max-h-[calc(100%-3.5rem)] origin-bottom",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

// className is a string: cn can't merge Base UI's state callback.
type SheetTriggerProps = Omit<ComponentProps<typeof SheetPrimitive.Trigger>, "className"> & {
  className?: string;
};
type SheetPopupProps = Omit<ComponentProps<typeof SheetPrimitive.Popup>, "className"> &
  VariantProps<typeof sheetVariants> & {
    className?: string;
    showCloseButton?: boolean;
  };
type SheetTitleProps = Omit<ComponentProps<typeof SheetPrimitive.Title>, "className"> & {
  className?: string;
};
type SheetDescriptionProps = Omit<
  ComponentProps<typeof SheetPrimitive.Description>,
  "className"
> & {
  className?: string;
};
type SheetCloseProps = Omit<ComponentProps<typeof SheetPrimitive.Close>, "className"> & {
  className?: string;
};

const Sheet = SheetPrimitive.Root;

// The header is the window's drag region. A trigger there has to opt out, or a
// click on it starts a window drag.
function SheetTrigger({ className, ...props }: SheetTriggerProps) {
  return (
    <SheetPrimitive.Trigger
      data-slot="sheet-trigger"
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

/**
 * The panel, over a flat backdrop, in a portal at the end of the body. Focus
 * moves into it when it opens, stays inside while it's open, and goes back to
 * the trigger when it closes. initialFocus and finalFocus change where.
 */
function SheetPopup({
  className,
  children,
  side,
  showCloseButton = true,
  ...props
}: SheetPopupProps) {
  return (
    <SheetPrimitive.Portal>
      {/* The backdrop covers the header too, so it mustn't be a window drag region. */}
      <SheetPrimitive.Backdrop
        data-slot="sheet-backdrop"
        className="app-no-drag fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-popup"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label="Close"
            className="absolute top-4 right-4"
            render={<Button variant="ghost" size="icon" />}
          >
            <X aria-hidden />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

// The end padding keeps a long title clear of the close button.
function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 pe-8", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "-mx-5 mt-auto -mb-5 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-title font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SheetClose({ className, ...props }: SheetCloseProps) {
  return <SheetPrimitive.Close data-slot="sheet-close" className={className} {...props} />;
}

export {
  Sheet,
  SheetClose,
  SheetPopup as SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
};
