import { CircleAlert, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { PiUpdate } from "../../shared/piUpdates";
import { applyPiUpdate, checkPiUpdates, useHost, usePiUpdates } from "../connection";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { CardGroup, CardGroupRow, CardGroupRowText, CardGroupRowTitle } from "../ui/card-group";
import { Spinner } from "../ui/spinner";
import { SubHeading } from "./rows";

function label(entry: PiUpdate): string {
  return entry.scope === "pi"
    ? "pi"
    : `${entry.scope === "project" ? "project" : "global"} package ${entry.name}`;
}

function version(value: string | null): string {
  if (value === null) return "Unknown";
  return /^[0-9a-f]{40,64}$/.test(value) ? value.slice(0, 8) : value;
}

export function PiUpdateSettings() {
  const updates = usePiUpdates();
  const connected = useHost((host) => host.connection === "connected");
  const restarting = useHost((host) => host.thread?.pi.state === "starting");
  const [confirm, setConfirm] = useState<PiUpdate | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = updates.checking || updates.updating || updates.applying !== null || !connected;
  return (
    <>
      <SubHeading
        title="Updates"
        description="Checks never install anything. Pinned versions and Git refs stay pinned. Local packages are yours to update."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="neutral" disabled={busy} onClick={() => checkPiUpdates()}>
          {updates.checking ? <Spinner size="sm" /> : <RefreshCw aria-hidden />}
          Check for updates
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {updates.applying !== null
            ? "Updating…"
            : updates.checking
              ? "Checking pi and packages…"
              : updates.updating
                ? "Preparing or finishing the update…"
                : updates.checkedAt === null
                  ? "Not checked yet. Automatic checks respect offline mode."
                  : `Checked ${new Date(updates.checkedAt).toLocaleTimeString()}`}
        </p>
      </div>
      <p className="text-xs break-words text-muted-foreground">
        {updates.project
          ? `Includes trusted project packages in ${updates.project}.`
          : "Includes pi and global pi packages. Check from a trusted thread to include its project packages."}{" "}
        Check for updates contacts the package registry and Git remotes, even in offline mode.
      </p>
      {updates.error ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Couldn't finish the update operation</AlertTitle>
          <AlertDescription className="break-words">{updates.error}</AlertDescription>
        </Alert>
      ) : null}
      {updates.entries.length ? (
        <CardGroup>
          {updates.entries.map((entry) => (
            <CardGroupRow key={entry.id} aria-label={entry.name}>
              <CardGroupRowText>
                <CardGroupRowTitle>{entry.scope === "pi" ? "pi" : entry.name}</CardGroupRowTitle>
                <p className="text-xs text-muted-foreground">
                  {entry.scope === "pi"
                    ? "Program"
                    : entry.scope === "project"
                      ? "Project package"
                      : "Global package"}
                  {" · "}
                  {version(entry.installed)}
                  {entry.latest ? ` → ${version(entry.latest)}` : ""}
                </p>
                <p className="text-xs break-words text-faint-foreground">
                  {entry.message ??
                    (entry.state === "available" ? "Update available" : "Up to date")}
                </p>
              </CardGroupRowText>
              {entry.state === "available" ? (
                <Button
                  variant="neutral"
                  disabled={busy || restarting}
                  aria-label={`Update ${label(entry)}`}
                  onClick={() => {
                    setConfirm(entry);
                    setConfirmOpen(true);
                  }}
                >
                  {updates.applying === entry.id ? <Spinner size="sm" /> : null}
                  Update
                </Button>
              ) : null}
            </CardGroupRow>
          ))}
        </CardGroup>
      ) : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Update ${confirm ? label(confirm) : "package"}?`}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {`Install ${version(confirm?.latest ?? null)} in place of ${version(confirm?.installed ?? null)}${confirm?.scope !== "pi" && confirm ? ` for ${confirm.source}` : ""}. `}
              Every thread must be idle and all integrated terminals closed. Tondo stops idle pi
              processes first, then resumes the visible thread on its saved session. Other threads
              resume when opened. Third-party packages can run install scripts. Git package updates
              reinstall dependencies, but Tondo refuses local files or edits that pi would discard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || restarting}
              onClick={() => {
                if (confirm) applyPiUpdate(confirm.id);
                setConfirmOpen(false);
              }}
            >
              Install update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
