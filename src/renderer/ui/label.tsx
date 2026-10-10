import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// A label right after its control dims with it. peer-disabled matches a native
// input; peer-data-disabled matches a Checkbox or Switch, whose root is a span
// that marks the state with data-disabled. A label that wraps its control mutes
// its text instead: opacity on the label would dim the control, already at
// 50%, a second time.
function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50 has-data-disabled:cursor-not-allowed has-data-disabled:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
