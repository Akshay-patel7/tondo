import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

// Hover gives an unpressed toggle the --accent wash buttons use. Pressed fills
// it with the text color, 12:1 or more against every surface where WCAG 1.4.11
// asks 3:1 for a state, so a pressed toggle reads at a glance and never looks
// like one under the pointer. The border takes the fill, so a pressed item in
// a joined outline group fills its segment. Each size names its radius, so
// the look of a size never fights the base.
const toggleVariants = cva(
  "group/toggle inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none not-aria-pressed:hover:bg-accent not-aria-pressed:hover:text-foreground focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        outline: "border-input bg-transparent",
      },
      size: {
        default:
          "h-7 min-w-7 gap-1.5 rounded-control px-2.5 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-6 min-w-6 gap-1 rounded-chip px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// className is a string: cn can't merge Base UI's state callback.
type ToggleProps = Omit<TogglePrimitive.Props, "className"> &
  VariantProps<typeof toggleVariants> & { className?: string };

function Toggle({ className, variant, size, ...props }: ToggleProps) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
