import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

const Combobox = ComboboxPrimitive.Root;

// className is a string: cn can't merge Base UI's state callback.
type InputProps = Omit<ComboboxPrimitive.Input.Props, "className"> & {
  className?: string;
  /** A button at the end that opens the list. */
  showTrigger?: boolean;
  /** A button at the end that clears the chosen value, shown while there is one. */
  showClear?: boolean;
};

/**
 * The text box that filters the list, in a field of the ui Input's look. Name
 * it with aria-label. Its className goes on the field.
 */
function ComboboxInput({
  className,
  disabled,
  showTrigger = true,
  showClear = false,
  ...props
}: InputProps) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-0.5 rounded-control border border-input bg-transparent text-sm transition-colors app-no-drag has-[button]:pr-1 has-[input:disabled]:opacity-50 has-[input:focus-visible]:focus-ring dark:bg-input/30",
        className,
      )}
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        disabled={disabled}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        {...props}
      />
      {showClear ? (
        <ComboboxPrimitive.Clear
          aria-label="Clear"
          disabled={disabled}
          render={<Button variant="ghost" size="icon-xs" />}
        >
          <XIcon aria-hidden />
        </ComboboxPrimitive.Clear>
      ) : null}
      {showTrigger ? (
        <ComboboxPrimitive.Trigger
          aria-label="Show options"
          disabled={disabled}
          render={<Button variant="ghost" size="icon-xs" />}
        >
          <ChevronDownIcon aria-hidden />
        </ComboboxPrimitive.Trigger>
      ) : null}
    </ComboboxPrimitive.InputGroup>
  );
}

type ContentProps = Omit<ComboboxPrimitive.Popup.Props, "className"> & {
  className?: string;
} & Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ContentProps) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "w-(--anchor-width) max-w-(--available-width) min-w-44 origin-(--transform-origin) overflow-hidden rounded-control border border-border bg-popover text-sm text-popover-foreground shadow-composer outline-none app-no-drag transition-[opacity,scale] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

type ListProps = Omit<ComboboxPrimitive.List.Props, "className"> & { className?: string };

function ComboboxList({ className, ...props }: ListProps) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(--spacing(72),var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

type ItemProps = Omit<ComboboxPrimitive.Item.Props, "className"> & { className?: string };

// Items sit 4px inside the list, so their corners are 4px tighter than the popup's.
function ComboboxItem({ className, children, ...props }: ItemProps) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-[calc(var(--control-radius)-4px)] py-1.5 pr-8 pl-2 outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxGroup(props: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" {...props} />;
}

type GroupLabelProps = Omit<ComboboxPrimitive.GroupLabel.Props, "className"> & {
  className?: string;
};

/** Names the ComboboxGroup it's in. Screen readers hear it as the group's name. */
function ComboboxGroupLabel({ className, ...props }: GroupLabelProps) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

const ComboboxCollection = ComboboxPrimitive.Collection;

type EmptyProps = Omit<ComboboxPrimitive.Empty.Props, "className"> & { className?: string };

/**
 * What the popup says when nothing matches. Base UI keeps it mounted as a
 * status region and gives it text only while the list is empty, so it takes
 * no room otherwise.
 */
function ComboboxEmpty({ className, ...props }: EmptyProps) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2 text-center text-sm text-muted-foreground not-empty:py-2", className)}
      {...props}
    />
  );
}

type SeparatorProps = Omit<ComboboxPrimitive.Separator.Props, "className"> & {
  className?: string;
};

function ComboboxSeparator({ className, ...props }: SeparatorProps) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
};
