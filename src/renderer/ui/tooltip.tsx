import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

const OPEN_DELAY_MS = 300;

// className is a string: cn can't merge Base UI's state callback.
type TooltipTriggerProps = Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, "className"> & {
  className?: string;
};
type TooltipContentProps = Omit<ComponentProps<typeof TooltipPrimitive.Popup>, "className"> &
  Pick<
    ComponentProps<typeof TooltipPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  > & { className?: string; variant?: "default" | "card" };

/**
 * A short label that shows while its trigger is hovered or has keyboard focus.
 * Screen readers don't get it, so the trigger still needs an accessible name.
 */
const Tooltip = TooltipPrimitive.Root;

// The header is the window's drag region. A trigger there has to opt out, or a
// click on it starts a window drag.
function TooltipTrigger({ className, delay = OPEN_DELAY_MS, ...props }: TooltipTriggerProps) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      delay={delay}
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

// Unlike shadcn's inverted tooltip, this one takes the popover colors, so a Kbd
// inside looks as it does everywhere else.
function TooltipContent({
  className,
  variant = "default",
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset = 0,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-popup"
          className={cn(
            "app-no-drag flex max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-control border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-composer transition-[opacity,scale] duration-100 ease-out has-data-[slot=kbd]:pe-1 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
            variant === "card" && "max-w-sm flex-col items-start gap-2 px-3 py-2.5",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipContent as TooltipPopup, TooltipTrigger };
