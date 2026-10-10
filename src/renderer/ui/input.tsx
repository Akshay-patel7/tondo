import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const inputVariants = cva(
  "w-full min-w-0 rounded-control border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30 dark:disabled:bg-input/80",
  {
    variants: {
      size: {
        default: "h-8",
        sm: "h-7",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

// className is a string: cn can't merge Base UI's state callback. size is the
// height variant; the native attribute, a width in characters, is left out.
type InputProps = Omit<InputPrimitive.Props, "className" | "size"> &
  VariantProps<typeof inputVariants> & { className?: string };

function Input({ className, size, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  );
}

export { Input };
