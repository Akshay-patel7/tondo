import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

const spinnerVariants = cva("shrink-0 animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
    },
    variant: {
      default: "",
      // The work log's running row: the spinner in --primary.
      primary: "text-primary",
    },
  },
  defaultVariants: {
    size: "md",
    variant: "default",
  },
});

type SpinnerProps = Omit<ComponentProps<typeof LoaderCircle>, "size"> &
  VariantProps<typeof spinnerVariants> & {
    /**
     * Names the work for screen readers and makes the spinner a status. Leave
     * it out when nearby text already says what's happening.
     */
    label?: string;
  };

/** Mount it only while the work runs: it repaints every frame it's on screen. */
function Spinner({ className, size, variant, label, ...props }: SpinnerProps) {
  return (
    <LoaderCircle
      data-slot="spinner"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(spinnerVariants({ size, variant }), className)}
      {...props}
    />
  );
}

export { Spinner };
