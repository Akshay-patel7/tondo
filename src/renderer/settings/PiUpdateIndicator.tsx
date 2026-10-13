import { RefreshCw } from "lucide-react";
import { usePiUpdates } from "../connection";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { openSettings } from "./store";

/** Keep Settings lazy while showing available updates beside Git status. */
export function PiUpdateIndicator() {
  const count = usePiUpdates(
    (updates) => updates.entries.filter((entry) => entry.state === "available").length,
  );
  const updating = usePiUpdates((updates) => updates.updating);
  if (!count && !updating) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => openSettings("pi")}
      aria-label={
        updating
          ? "Review update in progress"
          : `Review ${count} available ${count === 1 ? "update" : "updates"}`
      }
    >
      {updating ? <Spinner size="sm" /> : <RefreshCw aria-hidden />}
      {updating ? "Updating…" : `${count} ${count === 1 ? "update" : "updates"}`}
    </Button>
  );
}
