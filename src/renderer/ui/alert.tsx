import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// A grid of an optional icon, the text, and an optional AlertAction. With a
// description, the icon sits on the title's line and the action centers on the
// text. Without one, the icon, title and action center on one row.
//
// Status variants tint an opaque card, so an alert reads the same on any
// surface and can float as a toast. Titles mix a quarter of the text color into
// the status color, as Badge does, which keeps them above 4.5:1 in both themes.
// The mixes run in oklab: in oklch, mixing with a near-gray such as --card pulls
// the hue toward the gray's meaningless one, which turns info olive.
const alertVariants = cva(
  "group/alert relative grid w-full grid-cols-[minmax(0,1fr)] content-start items-center gap-x-3 rounded-panel border px-4 py-3 text-left text-sm text-card-foreground has-data-[slot=alert-action]:grid-cols-[minmax(0,1fr)_auto] has-data-[slot=alert-description]:items-start has-[>svg]:grid-cols-[auto_minmax(0,1fr)] has-[>svg]:has-data-[slot=alert-action]:grid-cols-[auto_minmax(0,1fr)_auto] [&>svg]:row-span-2 [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4 has-data-[slot=alert-description]:[&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card [&>svg]:text-muted-foreground",
        info: "border-info/30 bg-[color-mix(in_oklab,var(--info)_8%,var(--card))] dark:bg-[color-mix(in_oklab,var(--info)_12%,var(--card))] [&>svg]:text-info *:data-[slot=alert-title]:text-[color-mix(in_oklab,var(--info)_75%,var(--foreground))]",
        success:
          "border-success/30 bg-[color-mix(in_oklab,var(--success)_8%,var(--card))] dark:bg-[color-mix(in_oklab,var(--success)_12%,var(--card))] [&>svg]:text-success *:data-[slot=alert-title]:text-[color-mix(in_oklab,var(--success)_75%,var(--foreground))]",
        warning:
          "border-warning/30 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] dark:bg-[color-mix(in_oklab,var(--warning)_12%,var(--card))] [&>svg]:text-warning *:data-[slot=alert-title]:text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))]",
        destructive:
          "border-destructive/30 bg-[color-mix(in_oklab,var(--destructive)_8%,var(--card))] dark:bg-[color-mix(in_oklab,var(--destructive)_12%,var(--card))] [&>svg]:text-destructive *:data-[slot=alert-title]:text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type AlertProps = ComponentProps<"div"> & VariantProps<typeof alertVariants>;

/**
 * A banner, toast or onboarding card. Put an icon first, then AlertTitle,
 * AlertDescription and AlertAction. It has no role: add role="alert" when it
 * interrupts, or role="status" when it can wait.
 */
function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-1 font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-1 mt-0.5 text-pretty text-muted-foreground group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "col-start-2 row-start-1 flex items-center gap-2 self-center group-has-[>svg]/alert:col-start-3 group-has-data-[slot=alert-description]/alert:row-[1/span_2]",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
