import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

// Ghost in muted, regular-weight text: transparent at rest, the --accent wash
// and foreground text on hover or while its menu is open. Pressed, it takes
// the --selected fill and a --control-border edge: the fill alone is under
// 3:1 against the page, and a state needs 3:1 (WCAG 1.4.11).
const GHOST =
  "font-normal text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-pressed:border-control-border aria-pressed:bg-selected aria-pressed:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground aria-expanded:[&_svg]:text-foreground aria-pressed:[&_svg]:text-foreground";

// Each size names its radius, so the look of a size never fights the base.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding whitespace-nowrap outline-none select-none focus-visible:focus-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Hover mixes in the page's text color, darker in light and lighter in
        // dark, so the label keeps 4.5:1. An alpha fill would fade toward the page.
        default:
          "bg-primary font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_90%,var(--foreground))]",
        secondary:
          "bg-secondary font-medium text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        // A --input edge on a transparent fill, with ghost's hover.
        outline:
          "border-input bg-transparent font-normal text-foreground hover:bg-accent aria-expanded:bg-accent aria-pressed:border-control-border aria-pressed:bg-selected",
        // The 5% fill with a --input edge: "Changes", "View diff", "Choose pi…",
        // "Sign in…". Hover deepens the fill to 8%.
        neutral:
          "border-input bg-neutral font-normal text-foreground hover:bg-neutral-hover aria-expanded:bg-neutral-hover aria-pressed:border-control-border aria-pressed:bg-selected",
        // The sidebar's primary action: a --card fill with a --input edge, hover
        // on --message. Disabled, it keeps only a --border edge and faint text.
        raised:
          "border-input bg-card font-medium text-foreground hover:bg-message aria-expanded:bg-message aria-pressed:border-control-border aria-pressed:bg-selected disabled:border-border disabled:bg-transparent disabled:text-faint-foreground disabled:opacity-100",
        ghost: GHOST,
        // Ghost under another name, kept for the code that picked it when ghost
        // text was still full strength.
        quiet: GHOST,
        // Ghost in faint text: "Turn off", the sidebar's icon buttons.
        "faint-ghost":
          "font-normal text-faint-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-pressed:border-control-border aria-pressed:bg-selected aria-pressed:text-foreground",
        destructive:
          "bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90",
        link: "font-normal text-primary-text underline-offset-4 hover:underline",
        // The composer's Stop: the text color filled in, the page color on it.
        // Without a size it's icon-round. Put a 10px square in it:
        // <Square aria-hidden className="size-2.5 fill-current" />.
        stop: "bg-foreground font-medium text-background hover:bg-foreground/90",
        // The composer's Send: a 10% wash with a muted arrow while there is
        // nothing to send, and the primary fill once there is. Without a size
        // it's icon-round. The wash is the disabled look, so it isn't dimmed again.
        send: "bg-foreground/10 font-medium text-muted-foreground enabled:bg-primary enabled:text-primary-foreground enabled:hover:bg-[color-mix(in_oklab,var(--primary)_90%,var(--foreground))] disabled:opacity-100",
      },
      size: {
        question:
          "min-h-10 justify-start gap-2 rounded-control px-3 py-2 text-left text-sm whitespace-normal",
        default:
          "h-7 gap-1.5 rounded-control px-2.5 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        // The sidebar's primary buttons: 16px icons, 8px apart from the label.
        lg: "h-8 gap-2 rounded-control px-2 text-sm [&_svg:not([class*='size-'])]:size-4",
        sm: "h-6 gap-1 rounded-chip px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        xs: "h-5 gap-1 rounded-chip px-1.5 text-2xs has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        icon: "size-7 rounded-control [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-6 rounded-chip [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-chip [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 rounded-control [&_svg:not([class*='size-'])]:size-4",
        "icon-round": "size-8 rounded-full [&_svg:not([class*='size-'])]:size-4",
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
  const roundByDefault = variant === "stop" || variant === "send";
  const defaultProps = {
    className: cn(
      buttonVariants({ variant, size: size ?? (roundByDefault ? "icon-round" : undefined) }),
      className,
    ),
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
