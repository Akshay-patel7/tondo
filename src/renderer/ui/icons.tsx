// Small line icons, drawn on a 16px grid in the text color.
import type { ReactNode } from "react";

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3.5v9M3.5 8h9" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3 3" />
    </Icon>
  );
}

export function SidebarIcon() {
  return (
    <Icon>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M6.5 3v10" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <path d="M4 8h.01M8 8h.01M12 8h.01" strokeWidth="2.2" />
    </Icon>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <Icon className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="m6 4 4 4-4 4" />
    </Icon>
  );
}

export function PinIcon() {
  return (
    <Icon className="size-3.5 shrink-0">
      <path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 3L3 8l3-.5L8.5 5z" />
      <path d="m5.5 10.5-3 3" />
    </Icon>
  );
}

export function PenIcon() {
  return (
    <Icon className="size-3.5 shrink-0">
      <path d="m10.5 3 2.5 2.5-7 7H3.5V10z" />
    </Icon>
  );
}
