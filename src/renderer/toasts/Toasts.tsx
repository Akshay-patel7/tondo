// Toasts in the window's top right corner: an extension's notify, and how a
// slash command went. Info and warnings close after a while, unless the
// pointer or focus is on them. Errors stay until you close them.
import { useEffect, useState } from "react";
import { revealFile } from "../connection";
import { isMac } from "../platform";
import { CrossIcon } from "../ui/icons";
import { dismissToast, useToasts, type Toast } from "./store";

/** How long info and warnings stay on screen. */
const TOAST_MS = 5000;

const TONES = {
  info: "border-border",
  warning: "border-warning/40",
  error: "border-destructive/40",
};

export function Toasts() {
  const toasts = useToasts((all) => all);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-12 right-3 z-30 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const [held, setHeld] = useState(false);
  const { id, level, message, thread, reveal } = toast;

  useEffect(() => {
    if (level === "error" || held) return;
    const timer = setTimeout(() => dismissToast(id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, level, held]);

  return (
    <div
      role={level === "error" ? "alert" : "status"}
      data-toast={level}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={`pointer-events-auto flex items-start gap-2 rounded-control border bg-card py-2 pr-1.5 pl-3 text-sm shadow-composer ${TONES[level]}`}
    >
      <div className="min-w-0 flex-1 py-0.5">
        {thread === undefined ? null : (
          <p className="truncate text-xs text-muted-foreground">{thread}</p>
        )}
        <p
          className={`break-words whitespace-pre-wrap ${level === "error" ? "text-destructive" : ""}`}
        >
          {message}
        </p>
        {reveal === undefined ? null : (
          <button
            type="button"
            onClick={() => revealFile(reveal)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {isMac ? "Show in Finder" : "Show in folder"}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(id)}
        className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <CrossIcon />
      </button>
    </div>
  );
}
