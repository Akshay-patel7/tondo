import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// These are decoration: a row that needs its state read out says it in text.
const statusDotVariants = cva("inline-block size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      primary: "bg-primary",
      foreground: "bg-foreground",
      success: "bg-success",
      warning: "bg-warning",
    },
  },
  defaultVariants: {
    tone: "foreground",
  },
});

type StatusDotProps = ComponentProps<"span"> & VariantProps<typeof statusDotVariants>;

/** A 6px dot: primary for working, foreground for unread, success and warning for pi's state. */
function StatusDot({ className, tone, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden
      data-slot="status-dot"
      data-tone={tone ?? "foreground"}
      className={cn(statusDotVariants({ tone }), className)}
      {...props}
    />
  );
}

/** An 8px ring with a 1.5px --warning edge: a thread waiting for input. */
function StatusRing({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="status-ring"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full border-[1.5px] border-warning",
        className,
      )}
      {...props}
    />
  );
}

const tondoMarkVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full border-primary [&>span]:rounded-full [&>span]:bg-primary",
  {
    variants: {
      size: {
        default: "size-4 border-2 [&>span]:size-1",
        lg: "size-10 border-[3px] [&>span]:size-2.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

type TondoMarkProps = ComponentProps<"span"> & VariantProps<typeof tondoMarkVariants>;

/** The Tondo mark, a --primary ring with a dot inside: 16px in the sidebar, lg (40px) on Welcome. */
function TondoMark({ className, size, ...props }: TondoMarkProps) {
  return (
    <span
      aria-hidden
      data-slot="tondo-mark"
      data-size={size ?? "default"}
      className={cn(tondoMarkVariants({ size }), className)}
      {...props}
    >
      <span />
    </span>
  );
}

export { StatusDot, StatusRing, TondoMark };
