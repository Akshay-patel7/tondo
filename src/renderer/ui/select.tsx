import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { HTMLProps } from "@base-ui/react/types";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { createContext, useContext, useId } from "react";
import { cn } from "../lib/cn";

// The Select's id, which Base UI gives its trigger. The open list takes its
// name from a hidden copy of the trigger's aria-label, "<id>-name". It can't
// point at the trigger itself: a combobox that names something else lends it
// its chosen option, not its own label.
const SelectIdContext = createContext<string | undefined>(undefined);

/**
 * A picker. Give it `items`, a list of `{ value, label }`, so the trigger can
 * show the chosen item's label before the list has ever opened. Name the
 * trigger with aria-label: e2e finds a picker as the combobox of that name,
 * and screen readers hear the open list by the same name.
 */
function Select<Value, Multiple extends boolean | undefined = false>({
  id,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <SelectIdContext value={selectId}>
      <SelectPrimitive.Root<Value, Multiple> id={selectId} {...props} />
    </SelectIdContext>
  );
}

// Ghost in muted text that comes up to foreground on hover or while open.
const GHOST =
  "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground";

// Each size names its radius, so the look of a size never fights the base.
const selectTriggerVariants = cva(
  "flex w-fit min-w-0 items-center justify-between border whitespace-nowrap transition-colors outline-none select-none app-no-drag focus-visible:focus-ring data-disabled:pointer-events-none data-disabled:opacity-50 data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-input bg-transparent text-foreground hover:bg-accent data-popup-open:bg-accent [&_svg]:text-muted-foreground",
        ghost: GHOST,
        // The composer's model and thinking pickers: ghost at 12px with a 12px
        // chevron. Without a size it's `picker`.
        "ghost-picker": GHOST,
        // "Turn 3 of 3", the home page's project picker: a 24px --input edge on
        // a transparent fill. Without a size it's `xs`.
        "outline-sm":
          "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground",
      },
      size: {
        sm: "h-7 gap-1.5 rounded-control px-2.5 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-chip px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        picker: "h-7 gap-1 rounded-control px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

type TriggerVariants = VariantProps<typeof selectTriggerVariants>;

function defaultTriggerSize(variant: TriggerVariants["variant"]): TriggerVariants["size"] {
  if (variant === "ghost-picker") return "picker";
  if (variant === "outline-sm") return "xs";
  return undefined;
}

// Base UI keeps the value off the trigger's attributes. data-value puts it
// back, so e2e can read what a picker holds without opening it (e2e/ui.ts).
function renderTrigger(props: HTMLProps, state: SelectPrimitive.Trigger.State) {
  return <button {...props} data-value={state.value == null ? undefined : String(state.value)} />;
}

// className is a string: cn can't merge Base UI's state callback.
type TriggerProps = Omit<SelectPrimitive.Trigger.Props, "className" | "render"> & {
  className?: string;
} & TriggerVariants;

/** Put a SelectValue inside it. */
function SelectTrigger({ className, variant, size, children, ...props }: TriggerProps) {
  const selectId = useContext(SelectIdContext);
  const label = props["aria-label"];
  return (
    <>
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        className={cn(
          selectTriggerVariants({ variant, size: size ?? defaultTriggerSize(variant) }),
          className,
        )}
        render={renderTrigger}
        {...props}
      >
        {children}
        {/* As children, not the render prop: Icon's default children, a "▼", would end up in the svg and in the trigger's text. */}
        <SelectPrimitive.Icon className="flex">
          <ChevronDownIcon aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      {label === undefined || selectId === undefined ? null : (
        <span id={`${selectId}-name`} hidden>
          {label}
        </span>
      )}
    </>
  );
}

type ValueProps = Omit<SelectPrimitive.Value.Props, "className"> & { className?: string };

function SelectValue({ className, ...props }: ValueProps) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("min-w-0 flex-1 truncate text-left", className)}
      {...props}
    />
  );
}

const SCROLL_ARROW =
  "z-10 flex h-5 w-full cursor-default items-center justify-center bg-popover text-muted-foreground [&_svg]:size-3.5";

type ContentProps = Omit<SelectPrimitive.Popup.Props, "className"> & {
  className?: string;
} & Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >;

/**
 * The list, rendered into the body. Opened with the mouse, it sits over the
 * trigger with the chosen item on top of the trigger's label, like a macOS
 * pop-up button, and appears without a transition. Otherwise it drops below
 * the trigger and fades and zooms in, except under reduced motion.
 */
function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: ContentProps) {
  const selectId = useContext(SelectIdContext);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "relative flex max-h-(--available-height) max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-control border border-border bg-popover text-sm text-popover-foreground shadow-composer outline-none app-no-drag transition-[opacity,scale] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=none]:transition-none motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className={cn(SCROLL_ARROW, "top-0")}>
            <ChevronUpIcon aria-hidden />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List
            aria-labelledby={selectId === undefined ? undefined : `${selectId}-name`}
            className="min-h-0 scroll-py-1 overflow-y-auto p-1"
          >
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className={cn(SCROLL_ARROW, "bottom-0")}>
            <ChevronDownIcon aria-hidden />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

type GroupLabelProps = Omit<SelectPrimitive.GroupLabel.Props, "className"> & {
  className?: string;
};

/** Names the SelectGroup it's in. Screen readers hear it as the group's name. */
function SelectGroupLabel({ className, ...props }: GroupLabelProps) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-2xs font-medium text-faint-foreground", className)}
      {...props}
    />
  );
}

type ItemProps = Omit<SelectPrimitive.Item.Props, "className"> & { className?: string };

// Items sit 4px inside the list, so their corners are 4px tighter than the popup's.
function SelectItem({ className, children, ...props }: ItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-[calc(var(--control-radius)-4px)] py-1.5 pr-8 pl-2 outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

type SeparatorProps = Omit<SelectPrimitive.Separator.Props, "className"> & {
  className?: string;
};

function SelectSeparator({ className, ...props }: SeparatorProps) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  defaultTriggerSize,
  selectTriggerVariants,
};
