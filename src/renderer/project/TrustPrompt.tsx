import { CircleAlert, ShieldQuestionMark } from "lucide-react";
import { answerTrust, revealFile, useHost } from "../connection";
import { SetupCard } from "../onboarding/SetupCard";
import { isMac } from "../platform";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

/**
 * Asks whether pi may load the project's own settings and extensions. The
 * wording follows pi's trust prompt (core/project-trust.js in pi-coding-agent).
 */
export function TrustPrompt({ project }: { project: string }) {
  const error = useHost(({ thread, trustError }) =>
    trustError !== null && trustError.threadId === thread?.id ? trustError : null,
  );
  const reveal = error?.reveal;
  return (
    <SetupCard
      icon={<ShieldQuestionMark />}
      title="Trust project folder?"
      actions={
        <>
          {/* Focus starts on the answer that loads nothing. */}
          <Button variant="outline" autoFocus onClick={() => answerTrust(false)}>
            Don't trust
          </Button>
          <Button onClick={() => answerTrust(true)}>Trust</Button>
        </>
      }
    >
      <p className="font-mono text-xs break-all text-muted-foreground">{project}</p>
      <p>
        This allows pi to load .pi settings and resources, install missing project packages, and
        execute project extensions. If you don't trust it, pi starts without them. Tondo remembers
        your answer.
      </p>
      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle className="break-words whitespace-pre-wrap">{error.message}</AlertTitle>
          {reveal === undefined ? null : (
            <AlertDescription>
              <Button variant="link" size="xs" className="-ml-2" onClick={() => revealFile(reveal)}>
                {isMac ? "Show in Finder" : "Show in folder"}
              </Button>
            </AlertDescription>
          )}
        </Alert>
      )}
    </SetupCard>
  );
}
