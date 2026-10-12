import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

const kbdVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center font-sans font-normal whitespace-nowrap select-none [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        // A key cap: the --input edge keeps it visible on cards, popovers and
        // tooltips, whose color is within a few percent of the page's.
        default:
          "pointer-events-none h-5 min-w-5 gap-1 rounded-[5px] border border-input px-1 text-2xs tracking-wide text-muted-foreground",
        // Bare faint text, for the ⌘N and ⌘K beside a sidebar button's label
        // and a menu item's shortcut.
        hint: "pointer-events-none text-2xs tracking-wide text-faint-foreground",
        // The Shortcuts page's chord, which records a new one when pressed:
        // <Kbd variant="recorder" render={<button type="button" />}>⌘K</Kbd>.
        // Its edge turns --primary under the pointer and while it records.
        recorder:
          "h-6.5 min-w-14 gap-1 rounded-chip border border-input bg-foreground/4 px-2 text-xs tracking-[0.04em] text-foreground outline-none hover:border-primary focus-visible:focus-ring aria-pressed:border-primary disabled:pointer-events-none disabled:opacity-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type KbdProps = useRender.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>;

function Kbd({ className, variant, render, ...props }: KbdProps) {
  const defaultProps = {
    className: cn(kbdVariants({ variant }), className),
    "data-slot": "kbd",
  };
  return useRender({
    defaultTagName: "kbd",
    render,
    props: mergeProps<"kbd">(defaultProps, props),
  });
}

function KbdGroup({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup, kbdVariants };
