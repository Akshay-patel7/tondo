import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../lib/cn";

// className is a string: cn can't merge Base UI's state callback.
type CheckboxProps = Omit<CheckboxPrimitive.Root.Props, "className"> & { className?: string };

/**
 * Name it with a Label whose htmlFor matches its id, or wrap both in a label.
 * Base UI points the checkbox's aria-labelledby at that label. The root is a
 * span, so its states are data attributes, not :disabled or :checked. Its peer
 * class lets a Label placed after it dim while it's disabled.
 */
function Checkbox({ className, indeterminate, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-control-border transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:focus-ring aria-invalid:border-destructive aria-invalid:aria-checked:border-primary data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50 data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:bg-input/30 dark:data-checked:bg-primary dark:data-indeterminate:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current [&>svg]:size-3.5"
      >
        {indeterminate ? <Minus aria-hidden /> : <Check aria-hidden />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
