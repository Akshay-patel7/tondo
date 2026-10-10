import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// className is a string: cn can't merge Base UI's state callback.
type PopoverTriggerProps = Omit<ComponentProps<typeof PopoverPrimitive.Trigger>, "className"> & {
  className?: string;
};
type PopoverPopupProps = Omit<ComponentProps<typeof PopoverPrimitive.Popup>, "className"> &
  Pick<
    ComponentProps<typeof PopoverPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  > & { className?: string };
type PopoverTitleProps = Omit<ComponentProps<typeof PopoverPrimitive.Title>, "className"> & {
  className?: string;
};
type PopoverDescriptionProps = Omit<
  ComponentProps<typeof PopoverPrimitive.Description>,
  "className"
> & { className?: string };
type PopoverCloseProps = Omit<ComponentProps<typeof PopoverPrimitive.Close>, "className"> & {
  className?: string;
};

const Popover = PopoverPrimitive.Root;

// The header is the window's drag region. A trigger there has to opt out, or a
// click on it starts a window drag.
function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

/**
 * A panel anchored to its trigger, in a portal at the end of the body. A press
 * outside or Escape closes it, and focus goes back to the trigger.
 */
function PopoverPopup({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 8,
  alignOffset = 0,
  ...props
}: PopoverPopupProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-popup"
          className={cn(
            "app-no-drag flex w-72 origin-(--transform-origin) flex-col gap-3 rounded-control border border-border bg-popover p-3 text-sm text-popover-foreground shadow-composer outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="popover-header" className={cn("flex flex-col gap-1", className)} {...props} />
  );
}

function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverDescriptionProps) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function PopoverClose({ className, ...props }: PopoverCloseProps) {
  return <PopoverPrimitive.Close data-slot="popover-close" className={className} {...props} />;
}

export {
  Popover,
  PopoverClose,
  PopoverPopup as PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
};
