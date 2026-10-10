import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

// Status badges tint the surface with their color and mix a quarter of the
// text color into the label, which keeps it above 4.5:1 in both themes. The
// plain token reaches only 3.7:1 for warning on a light tint. The mix is in
// oklab, which keeps the label on its token's hue: in oklch, info would turn
// violet in light and cyan in dark.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:focus-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [a]:hover:bg-[color-mix(in_oklab,var(--primary)_90%,var(--foreground))]",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        outline:
          "border-border text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        destructive:
          "bg-destructive/10 text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))] dark:bg-destructive/15 [a]:hover:bg-destructive/20",
        warning:
          "bg-warning/10 text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))] dark:bg-warning/15 [a]:hover:bg-warning/20",
        success:
          "bg-success/10 text-[color-mix(in_oklab,var(--success)_75%,var(--foreground))] dark:bg-success/15 [a]:hover:bg-success/20",
        info: "bg-info/10 text-[color-mix(in_oklab,var(--info)_75%,var(--foreground))] dark:bg-info/15 [a]:hover:bg-info/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, render, ...props }: BadgeProps) {
  const defaultProps = {
    className: cn(badgeVariants({ variant }), className),
    "data-slot": "badge",
  };
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
  });
}

export { Badge, badgeVariants };
