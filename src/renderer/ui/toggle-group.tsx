import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext, useMemo, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import { toggleVariants } from "./toggle";

type ToggleGroupLook = VariantProps<typeof toggleVariants> & { spacing?: number };

// Items take the group's variant and size, so one group never mixes looks.
const ToggleGroupContext = createContext<ToggleGroupLook>({});

// className is a string: cn can't merge Base UI's state callback. The group
// sets its own style, which carries the gap.
type ToggleGroupProps<Value extends string> = Omit<
  ToggleGroupPrimitive.Props<Value>,
  "className" | "style"
> &
  VariantProps<typeof toggleVariants> & {
    className?: string;
    /** The gap between items in Tailwind spacing steps. 0 joins them into one control. */
    spacing?: number;
  };

/**
 * Toggles of which one is pressed at a time. value and onValueChange are Base
 * UI's: an array of the pressed items' values, empty when the pressed item is
 * clicked again. Name the group with aria-label.
 */
function ToggleGroup<Value extends string>({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}: ToggleGroupProps<Value>) {
  const look = useMemo(() => ({ variant, size, spacing }), [variant, size, spacing]);
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      data-spacing={spacing}
      style={{ "--gap": spacing } as CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-vertical:flex-col data-vertical:items-stretch",
        className,
      )}
      {...props}
    >
      <ToggleGroupContext value={look}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive>
  );
}

// className is a string: cn can't merge Base UI's state callback.
type ToggleGroupItemProps = Omit<TogglePrimitive.Props, "className"> &
  VariantProps<typeof toggleVariants> & { className?: string };

function ToggleGroupItem({ className, variant, size, ...props }: ToggleGroupItemProps) {
  const group = useContext(ToggleGroupContext);
  const itemVariant = group.variant ?? variant;
  const itemSize = group.size ?? size;
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={itemVariant ?? "default"}
      data-size={itemSize ?? "default"}
      data-spacing={group.spacing}
      className={cn(
        toggleVariants({ variant: itemVariant, size: itemSize }),
        // With no gap, outline items join into one control: inner corners
        // square off and neighbors share a border. Borderless items stay whole
        // pills, so a pressed one never looks cut off.
        "focus-visible:z-10 data-[spacing=0]:data-[variant=outline]:rounded-none group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:rounded-l-control group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:last:rounded-r-control group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:rounded-t-control group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:last:rounded-b-control group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:not-first:border-t-0",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
