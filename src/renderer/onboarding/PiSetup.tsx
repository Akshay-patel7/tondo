import {
  CircleAlert,
  CircleFadingArrowUp,
  FileX,
  FolderOpen,
  PackageSearch,
  RotateCw,
  Settings,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { PiProblem } from "../../shared/protocol";
import { choosePiPath, retryPi, useHost } from "../connection";
import { openSettings } from "../settings/store";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { SetupCard } from "./SetupCard";

/** The command that installs pi, or updates it to the latest version. */
const INSTALL_PI = "npm install -g @earendil-works/pi-coding-agent";

const TITLES: Readonly<Record<PiProblem["kind"], string>> = {
  "not-found": "pi isn't installed",
  "too-old": "Tondo needs a newer pi",
  invalid: "That isn't pi",
};

const ICONS: Readonly<Record<PiProblem["kind"], typeof PackageSearch>> = {
  "not-found": PackageSearch,
  "too-old": CircleFadingArrowUp,
  invalid: FileX,
};

const NEXT_STEPS: Readonly<Record<PiProblem["kind"], string>> = {
  "not-found": "To install pi, run this in a terminal, then check again:",
  "too-old": "To update pi, run this in a terminal, then check again:",
  invalid: "Choose the pi command that npm installed, or install pi and check again:",
};

function whatTondoTried(problem: PiProblem): string {
  if (problem.kind === "too-old")
    return `${problem.command} is pi ${problem.version}, and Tondo needs ${problem.required} or newer.`;
  return /[.!?]$/.test(problem.detail) ? problem.detail : `${problem.detail}.`;
}

/** Shown in place of a thread whose pi Tondo couldn't find, or can't run. */
export function PiSetup({ problem }: { problem: PiProblem }) {
  const connected = useHost((host) => host.connection === "connected");
  const settingsError = useHost((host) => host.settingsError);
  const title = useRef<HTMLHeadingElement>(null);
  // Focus moves to the heading, so a screen reader starts with what's wrong.
  useEffect(() => {
    title.current?.focus();
  }, []);
  const Icon = ICONS[problem.kind];
  return (
    <SetupCard
      icon={<Icon />}
      title={TITLES[problem.kind]}
      titleRef={title}
      actions={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => openSettings("pi")}>
            <Settings data-icon="inline-start" aria-hidden />
            Open settings
          </Button>
          <Button variant="outline" disabled={!connected} onClick={choosePiPath}>
            <FolderOpen data-icon="inline-start" aria-hidden />
            Choose pi…
          </Button>
          <Button disabled={!connected} onClick={retryPi}>
            <RotateCw data-icon="inline-start" aria-hidden />
            Check again
          </Button>
        </>
      }
    >
      <p className="break-words text-muted-foreground">{whatTondoTried(problem)}</p>
      <div>
        <p>{NEXT_STEPS[problem.kind]}</p>
        <code className="mt-2 block rounded-control border border-border bg-muted px-3 py-2 font-mono text-xs select-all">
          {INSTALL_PI}
        </code>
      </div>
      {settingsError ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>Tondo didn't save that change</AlertTitle>
          <AlertDescription className="break-words">{settingsError}</AlertDescription>
        </Alert>
      ) : null}
    </SetupCard>
  );
}
