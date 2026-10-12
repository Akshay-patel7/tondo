import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Kbd } from "./kbd";

// Every menu popup looks like this, here and in context-menu.tsx. It fades and
// zooms in from its anchor in 100 ms, and does neither under reduced motion.
// app-no-drag keeps a popup that overlaps the header clickable, because
// Electron's drag regions ignore z-index.
const POPUP =
  "max-h-(--available-height) max-w-(--available-width) min-w-[max(var(--anchor-width),--spacing(44))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-control border border-border bg-popover p-1 text-sm text-popover-foreground shadow-composer outline-none app-no-drag transition-[opacity,scale] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none";

// Items sit 4px inside the popup, so their corners are 4px tighter than its own.
const menuItemVariants = cva(
  "relative flex cursor-default items-center gap-2 rounded-[calc(var(--control-radius)-4px)] px-2 py-1.5 outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "data-highlighted:bg-accent data-highlighted:text-foreground [&>svg]:text-muted-foreground data-highlighted:[&>svg]:text-foreground",
        // A quarter of the text color keeps the label above 4.5:1 on the
        // highlight's tint in both themes, as in badge.tsx.
        destructive:
          "text-[color-mix(in_oklch,var(--destructive)_75%,var(--foreground))] data-highlighted:bg-destructive/10 dark:data-highlighted:bg-destructive/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const FIRST_ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

/**
 * Base UI highlights the first item only when the keyboard opens a menu. After
 * a click it focuses the popup itself. This focuses the first item a frame
 * after the popup mounts, as Tondo's menus always have, so arrow keys and
 * Enter start from it. A menu that already has a highlighted item, such as one
 * opened with ArrowUp, keeps it.
 */
function focusFirstItem(popup: HTMLDivElement | null) {
  if (!popup) return undefined;
  const frame = requestAnimationFrame(() => {
    if (!popup.isConnected || popup.querySelector("[data-highlighted]")) return;
    popup.querySelector<HTMLElement>(FIRST_ITEM)?.focus({ preventScroll: true });
  });
  return () => cancelAnimationFrame(frame);
}

const DropdownMenu = MenuPrimitive.Root;

// className is a string: cn can't merge Base UI's state callback.
type TriggerProps = Omit<MenuPrimitive.Trigger.Props, "className"> & { className?: string };

/** Opens the menu. Render it as a ui Button: `render={<Button variant="ghost" />}`. */
function DropdownMenuTrigger({ className, ...props }: TriggerProps) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn("app-no-drag", className)}
      {...props}
    />
  );
}

type PopupProps = Omit<MenuPrimitive.Popup.Props, "className" | "ref"> & { className?: string };

/**
 * The popup of a dropdown or context menu. DropdownMenuContent and
 * ContextMenuContent place it; render one of those instead.
 */
function DropdownMenuPopup({ className, ...props }: PopupProps) {
  return <MenuPrimitive.Popup ref={focusFirstItem} className={cn(POPUP, className)} {...props} />;
}

type ContentProps = PopupProps &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

/**
 * The menu, rendered into the body and placed below its trigger. It unmounts
 * when it closes, and its accessible name is the trigger's.
 */
function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: ContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <DropdownMenuPopup data-slot="dropdown-menu-content" {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

type LabelProps = Omit<MenuPrimitive.GroupLabel.Props, "className"> & { className?: string };

/**
 * Names the group it's in, so it has to be inside a DropdownMenuGroup or a
 * DropdownMenuRadioGroup. Screen readers hear it as the group's name.
 */
function DropdownMenuLabel({ className, ...props }: LabelProps) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-2xs font-medium text-faint-foreground", className)}
      {...props}
    />
  );
}

type ItemProps = Omit<MenuPrimitive.Item.Props, "className"> & {
  className?: string;
} & VariantProps<typeof menuItemVariants>;

function DropdownMenuItem({ className, variant, ...props }: ItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(menuItemVariants({ variant }), className)}
      {...props}
    />
  );
}

type CheckboxItemProps = Omit<MenuPrimitive.CheckboxItem.Props, "className"> & {
  className?: string;
};

function DropdownMenuCheckboxItem({ className, children, ...props }: CheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(menuItemVariants(), "pr-8", className)}
      {...props}
    >
      {children}
      <MenuPrimitive.CheckboxItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden />
      </MenuPrimitive.CheckboxItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

type RadioItemProps = Omit<MenuPrimitive.RadioItem.Props, "className"> & { className?: string };

function DropdownMenuRadioItem({ className, children, ...props }: RadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItemVariants(), "pr-8", className)}
      {...props}
    >
      {children}
      <MenuPrimitive.RadioItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

type SeparatorProps = Omit<MenuPrimitive.Separator.Props, "className"> & { className?: string };

function DropdownMenuSeparator({ className, ...props }: SeparatorProps) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

/**
 * The item's keyboard shortcut, at its end, such as `⌘N`. Its text becomes
 * part of the item's accessible name.
 */
function DropdownMenuShortcut({
  className,
  variant = "hint",
  ...props
}: ComponentProps<typeof Kbd>) {
  return <Kbd variant={variant} className={cn("ml-auto", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
};
