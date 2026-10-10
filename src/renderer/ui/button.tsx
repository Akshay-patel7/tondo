import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:focus-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Hover mixes in the page's text color, darker in light and lighter in
        // dark, so the label keeps 4.5:1. An alpha fill would fade toward the page.
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_90%,var(--foreground))]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        outline:
          "border-input bg-background hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:bg-input/30",
        // Icons stay muted until hover, like the header's icon buttons. Pressed,
        // the border turns --control-border: the accent fill alone is under 3:1
        // against the page, and a state needs 3:1 (WCAG 1.4.11).
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground aria-pressed:border-control-border aria-pressed:bg-accent aria-pressed:text-accent-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-accent-foreground aria-expanded:[&_svg]:text-accent-foreground aria-pressed:[&_svg]:text-accent-foreground",
        // Ghost in muted, regular-weight text that comes up to full strength on
        // hover, open or pressed, for text actions beside a title they mustn't
        // outshout. Pressed, it gets ghost's border.
        quiet:
          "font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground aria-pressed:border-control-border aria-pressed:bg-accent aria-pressed:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Primary darkened toward the text color, so a link passes 4.5:1 in both themes.
        link: "text-[color-mix(in_oklch,var(--primary)_80%,var(--foreground))] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-round": "size-8 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = useRender.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

/**
 * A button, or with `render` another element that looks like one. It's built
 * on Base UI's useRender rather than its Button, because Base UI's Button gives
 * whatever it renders role="button", and a link has to stay a link.
 */
function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const defaultProps = {
    className: cn(buttonVariants({ variant, size }), className),
    "data-slot": "button",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  });
}

export { Button, buttonVariants };
