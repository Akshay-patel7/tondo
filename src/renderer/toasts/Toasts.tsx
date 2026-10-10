// Toasts in the window's top right corner: an extension's notify, and how a
// slash command went. Info and warnings close after a while, unless the
// pointer or focus is on them. Errors stay until you close them.
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { revealFile } from "../connection";
import { isMac } from "../platform";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { dismissToast, useToasts, type Toast } from "./store";

/** How long info and warnings stay on screen. */
const TOAST_MS = 5000;

const VARIANTS = { info: "default", warning: "warning", error: "destructive" } as const;
const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert };

export function Toasts() {
  const toasts = useToasts((all) => all);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-12 right-3 z-30 flex w-88 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const [held, setHeld] = useState(false);
  const { id, level, message, thread, reveal } = toast;
  const Icon = ICONS[level];

  useEffect(() => {
    if (level === "error" || held) return;
    const timer = setTimeout(() => dismissToast(id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, level, held]);

  return (
    // An Alert has no shadow of its own, and a toast floats over the thread.
    <div className="pointer-events-auto rounded-panel shadow-composer">
      <Alert
        variant={VARIANTS[level]}
        role={level === "error" ? "alert" : "status"}
        data-toast={level}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <Icon aria-hidden />
        <AlertTitle className="break-words whitespace-pre-wrap">{message}</AlertTitle>
        {thread === undefined && reveal === undefined ? null : (
          <AlertDescription>
            {thread === undefined ? null : <p className="truncate">{thread}</p>}
            {reveal === undefined ? null : (
              <Button variant="link" size="xs" className="-ml-2" onClick={() => revealFile(reveal)}>
                {isMac ? "Show in Finder" : "Show in folder"}
              </Button>
            )}
          </AlertDescription>
        )}
        <AlertAction>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={() => dismissToast(id)}
          >
            <X aria-hidden />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
