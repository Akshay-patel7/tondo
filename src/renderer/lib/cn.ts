import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge drops the earlier of two classes that set the same thing, but
// it knows only Tailwind's default theme. Without these names it wouldn't see
// that rounded-control and rounded-lg conflict, and it would take
// shadow-composer for a shadow color. The color names are the tokens in
// index.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "background",
        "foreground",
        "card",
        "card-foreground",
        "popover",
        "popover-foreground",
        "message",
        "message-foreground",
        "muted",
        "muted-foreground",
        "accent",
        "accent-foreground",
        "primary",
        "primary-foreground",
        "secondary",
        "secondary-foreground",
        "destructive",
        "destructive-foreground",
        "warning",
        "warning-foreground",
        "success",
        "success-foreground",
        "info",
        "info-foreground",
        "addition",
        "deletion",
        "border",
        "input",
        "control-border",
        "ring",
        "sidebar",
      ],
      radius: ["control", "panel"],
      shadow: ["composer"],
    },
  },
});

/** Joins class names and drops the earlier of any two that conflict. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
