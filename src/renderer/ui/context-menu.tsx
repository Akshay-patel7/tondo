import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPopup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "./dropdown-menu";

const ContextMenu = ContextMenuPrimitive.Root;

// className is a string: cn can't merge Base UI's state callback.
type TriggerProps = Omit<ContextMenuPrimitive.Trigger.Props, "className"> & { className?: string };

/**
 * The area a right click opens the menu in. It renders a div, so render it as
 * the element it stands for, such as `render={<li />}`. select-none stops the
 * right click from selecting the word under the pointer.
 */
function ContextMenuTrigger({ className, ...props }: TriggerProps) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("app-no-drag select-none", className)}
      {...props}
    />
  );
}

/**
 * The menu, rendered into the body at the pointer. It unmounts when it
 * closes. It has no trigger button to take a name from, so give it an
 * aria-label.
 */
function ContextMenuContent(props: ComponentProps<typeof DropdownMenuPopup>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <DropdownMenuPopup data-slot="context-menu-content" {...props} />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

// Inside the popup, Base UI's context menu uses the menu's own parts, so these
// are the dropdown menu's.
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuRadioGroup as ContextMenuRadioGroup,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
};
