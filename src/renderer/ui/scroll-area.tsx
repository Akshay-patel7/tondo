import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// className is a string: cn can't merge Base UI's state callback.
type ScrollAreaProps = Omit<ComponentProps<typeof ScrollAreaPrimitive.Root>, "className"> & {
  className?: string;
};

/**
 * A scrolling region with thin scrollbars drawn over its edge. They take no
 * room, so content doesn't shift when it starts to overflow. They show while
 * the pointer is over the region or it scrolls. Give it a height or max-h-*.
 */
function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("group/scroll-area relative min-h-0 rounded-[inherit]", className)}
      {...props}
    >
      {/* max-h-[inherit] lets a max-h-* on the area cap the viewport, which then scrolls. The ring
          is inset, because the usual one would sit outside the area, where a parent often clips it. */}
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full max-h-[inherit] overscroll-contain rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  );
}

// Base UI positions the bar absolutely along the viewport's edge and renders it
// only while that axis overflows.
function ScrollBar({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className="flex p-0.5 opacity-0 transition-opacity delay-300 duration-150 group-hover/scroll-area:opacity-100 group-hover/scroll-area:delay-0 data-scrolling:opacity-100 data-scrolling:delay-0 data-horizontal:h-2.5 data-horizontal:flex-col data-vertical:w-2.5"
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="flex-1 rounded-full bg-foreground/20 transition-colors hover:bg-foreground/35"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea };
