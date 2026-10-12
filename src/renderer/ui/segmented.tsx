import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext, useState } from "react";
import { cn } from "../lib/cn";

// 2px of padding around the items, whose corners are 2px tighter than the
// group's, so the chosen item's fill sits concentric with the group's edge.
const segmentedVariants = cva(
  "group/segmented inline-flex w-fit shrink-0 items-center gap-0.5 bg-neutral p-0.5",
  {
    variants: {
      size: {
        default: "rounded-control",
        sm: "rounded-[7px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const segmentedItemVariants = cva(
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap text-xs text-muted-foreground outline-none select-none not-aria-pressed:hover:text-foreground focus-visible:z-10 focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-segment aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "h-7 gap-1.5 rounded-chip px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-5 gap-1 rounded-[5px] px-2 [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

type SegmentedSize = NonNullable<VariantProps<typeof segmentedVariants>["size"]>;

const SegmentedSizeContext = createContext<SegmentedSize>("default");

// className is a string: cn can't merge Base UI's state callback. One item is
// always pressed, so `multiple` is left out.
type SegmentedProps<Value extends string> = Omit<
  ToggleGroupPrimitive.Props<Value>,
  "className" | "multiple"
> &
  VariantProps<typeof segmentedVariants> & { className?: string };

/**
 * A segmented control: one of its items is pressed at a time, and pressing it
 * again changes nothing. value and onValueChange are Base UI's ToggleGroup's,
 * an array with the pressed item's value, so arrow keys move between items
 * and Tab leaves the group. Name the group with aria-label or aria-labelledby.
 */
function Segmented<Value extends string>({
  className,
  size,
  value,
  defaultValue,
  onValueChange,
  children,
  ...props
}: SegmentedProps<Value>) {
  const [ownValue, setOwnValue] = useState<readonly Value[]>(defaultValue ?? []);
  const groupSize = size ?? "default";
  const handleValueChange: NonNullable<SegmentedProps<Value>["onValueChange"]> = (
    next,
    details,
  ) => {
    if (next.length === 0) return;
    if (value === undefined) setOwnValue(next);
    onValueChange?.(next, details);
  };
  return (
    <ToggleGroupPrimitive
      data-slot="segmented"
      data-size={groupSize}
      className={cn(segmentedVariants({ size }), className)}
      value={value ?? ownValue}
      onValueChange={handleValueChange}
      {...props}
    >
      <SegmentedSizeContext value={groupSize}>{children}</SegmentedSizeContext>
    </ToggleGroupPrimitive>
  );
}

type SegmentedItemProps = Omit<TogglePrimitive.Props, "className"> & { className?: string };

function SegmentedItem({ className, ...props }: SegmentedItemProps) {
  const size = useContext(SegmentedSizeContext);
  return (
    <TogglePrimitive
      data-slot="segmented-item"
      data-size={size}
      className={cn(segmentedItemVariants({ size }), className)}
      {...props}
    />
  );
}

export { Segmented, SegmentedItem };
