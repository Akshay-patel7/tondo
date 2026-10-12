import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * A card of rows with 1px dividers: a Settings group, the Welcome checklist.
 * Put CardGroupRows straight inside it, each with a CardGroupRowText (a
 * CardGroupRowTitle over a CardGroupRowDescription) and its control.
 */
function CardGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-group"
      className={cn(
        "flex w-full flex-col divide-y divide-border rounded-card border border-border bg-card text-sm text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

// A row lays its parts out in a wrapping flex row. Pass `grid grid-cols-*` to
// make it a grid instead, as the Welcome checklist does for its icon column.
const cardGroupRowVariants = cva("group/card-row flex flex-wrap items-center", {
  variants: {
    size: {
      default: "gap-x-4 gap-y-3 p-4",
      sm: "gap-x-3 gap-y-2 py-3 pr-3 pl-4",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

type CardGroupRowProps = ComponentProps<"div"> & VariantProps<typeof cardGroupRowVariants>;

function CardGroupRow({ className, size, ...props }: CardGroupRowProps) {
  return (
    <div
      data-slot="card-group-row"
      data-size={size ?? "default"}
      className={cn(cardGroupRowVariants({ size }), className)}
      {...props}
    />
  );
}

function CardGroupRowText({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-group-row-text"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 group-data-[size=sm]/card-row:gap-0.5",
        className,
      )}
      {...props}
    />
  );
}

function CardGroupRowTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-group-row-title" className={cn("font-medium", className)} {...props} />
  );
}

function CardGroupRowDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-group-row-description"
      className={cn("text-xs text-pretty text-faint-foreground", className)}
      {...props}
    />
  );
}

export { CardGroup, CardGroupRow, CardGroupRowDescription, CardGroupRowText, CardGroupRowTitle };
