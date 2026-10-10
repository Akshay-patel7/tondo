// Adapted from apps/web/src/components/ui/number-field.tsx in T3 Code at 53456bc0.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";
import { cn } from "../lib/cn";

// className is a string on every part: cn can't merge Base UI's state callback.
type NumberFieldProps = Omit<NumberFieldPrimitive.Root.Props, "className"> & {
  className?: string;
};

/**
 * Holds a Label and a NumberFieldGroup. Base UI gives the root's id to the
 * input, so <Label htmlFor={id}> names the field from inside the root or from
 * anywhere else on the page.
 */
function NumberField({ className, ...props }: NumberFieldProps) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("flex w-full flex-col items-start gap-2", className)}
      {...props}
    />
  );
}

type NumberFieldGroupProps = Omit<NumberFieldPrimitive.Group.Props, "className"> & {
  className?: string;
};

// The group draws the field, so the focus ring wraps the buttons with the input.
function NumberFieldGroup({ className, ...props }: NumberFieldGroupProps) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "relative flex h-8 w-full rounded-control border border-input bg-transparent text-sm transition-colors has-aria-invalid:border-destructive has-[input:disabled]:cursor-not-allowed has-[input:disabled]:bg-input/50 has-[input:disabled]:opacity-50 has-[input:focus-visible]:focus-ring dark:bg-input/30 dark:has-[input:disabled]:bg-input/80",
        className,
      )}
      {...props}
    />
  );
}

type NumberFieldInputProps = Omit<NumberFieldPrimitive.Input.Props, "className"> & {
  className?: string;
};

function NumberFieldInput({ className, ...props }: NumberFieldInputProps) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "w-full min-w-0 flex-1 bg-transparent px-1 text-center tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

// Base UI names the buttons "Decrease" and "Increase", keeps them out of the
// tab order since the input's arrow keys do the same, and disables each one at
// its end of the range. When a screen has more than one field, pass an
// aria-label that names the field too.
const stepperClasses =
  "flex w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none data-disabled:opacity-50 [&:not([data-disabled])]:hover:bg-accent [&:not([data-disabled])]:hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-3.5";

type NumberFieldDecrementProps = Omit<
  NumberFieldPrimitive.Decrement.Props,
  "className" | "children"
> & { className?: string };

function NumberFieldDecrement({ className, ...props }: NumberFieldDecrementProps) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(stepperClasses, "rounded-s-[calc(var(--control-radius)-1px)]", className)}
      {...props}
    >
      <Minus aria-hidden />
    </NumberFieldPrimitive.Decrement>
  );
}

type NumberFieldIncrementProps = Omit<
  NumberFieldPrimitive.Increment.Props,
  "className" | "children"
> & { className?: string };

function NumberFieldIncrement({ className, ...props }: NumberFieldIncrementProps) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(stepperClasses, "rounded-e-[calc(var(--control-radius)-1px)]", className)}
      {...props}
    >
      <Plus aria-hidden />
    </NumberFieldPrimitive.Increment>
  );
}

export {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
};
