import type { MouseEvent, ReactNode, Ref } from "react";

/** A square button that shows only an icon. `label` names it for screen readers and its tooltip. */
export function IconButton({
  label,
  shortcut,
  onClick,
  className = "",
  disabled = false,
  ref,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={`app-no-drag flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground outline-none enabled:hover:bg-accent enabled:hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
