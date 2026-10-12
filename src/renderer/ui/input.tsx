import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Each size names its radius, so the look of a size never fights the base.
const inputVariants = cva(
  "w-full min-w-0 border bg-subtle transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "border-input text-foreground placeholder:text-muted-foreground",
        // The Changes panel's "Filter files": a --border edge on the 3% fill,
        // 12px text, faint placeholder. FilterInput adds the search icon.
        filter: "border-border text-xs text-foreground placeholder:text-faint-foreground",
      },
      size: {
        default: "h-7 rounded-control px-2.5 text-sm",
        sm: "h-6 rounded-chip px-2 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// className is a string: cn can't merge Base UI's state callback. size is the
// height variant; the native attribute, a width in characters, is left out.
type InputProps = Omit<InputPrimitive.Props, "className" | "size"> &
  VariantProps<typeof inputVariants> & { className?: string };

function Input({ className, variant, size, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(inputVariants({ variant, size }), className)}
      {...props}
    />
  );
}

type FilterInputProps = Omit<InputProps, "variant" | "size"> & {
  /** The 12px icon at the start, a search glass unless another is given. */
  icon?: ReactNode;
};

const SEARCH_ICON = <SearchIcon aria-hidden />;

/**
 * A 28px filter field with a leading icon slot. Its className goes on the
 * field; the other props go to the input, which still needs an aria-label.
 */
function FilterInput({ className, icon = SEARCH_ICON, ...props }: FilterInputProps) {
  return (
    <div
      data-slot="filter-input"
      className={cn(
        "relative flex h-7 w-full min-w-0 items-center text-faint-foreground",
        className,
      )}
    >
      <span className="pointer-events-none absolute start-2 flex [&_svg]:size-3 [&_svg]:shrink-0">
        {icon}
      </span>
      <InputPrimitive
        data-slot="input"
        className={cn(inputVariants({ variant: "filter" }), "h-full ps-7")}
        {...props}
      />
    </div>
  );
}

export { FilterInput, Input, inputVariants };
