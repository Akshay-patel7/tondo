import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

// The track's transparent 1px border shows the track color around the thumb.
// The thumb travels the track's inner width less its own, which at both sizes
// is the thumb's width less 2px. Unchecked, the track is --control-border, 3:1
// against the surface and the thumb. The root's peer class lets a Label placed
// after it dim while it's disabled.
const switchVariants = cva(
  "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:focus-ring aria-invalid:border-destructive data-checked:bg-primary data-unchecked:bg-control-border data-disabled:cursor-not-allowed data-disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-4.5 w-8",
        sm: "h-3.5 w-6",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const thumbVariants = cva(
  "pointer-events-none block rounded-full bg-background transition-transform data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground",
  {
    variants: {
      size: {
        default: "size-4",
        sm: "size-3",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

// className is a string: cn can't merge Base UI's state callback.
type SwitchProps = Omit<SwitchPrimitive.Root.Props, "className"> &
  VariantProps<typeof switchVariants> & { className?: string };

/**
 * Name it with a Label whose htmlFor matches its id, or wrap both in a label.
 * Base UI points the switch's aria-labelledby at that label.
 */
function Switch({ className, size, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size ?? "default"}
      className={cn(switchVariants({ size }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumbVariants({ size })} />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
