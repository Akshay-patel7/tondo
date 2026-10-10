import { ShieldQuestionMark } from "lucide-react";
import { answerTrust } from "../connection";
import { SetupCard } from "../onboarding/SetupCard";
import { Button } from "../ui/button";

/**
 * Asks whether pi may load the project's own settings and extensions. The
 * wording follows pi's trust prompt (core/project-trust.js in pi-coding-agent).
 */
export function TrustPrompt({ project }: { project: string }) {
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
    </SetupCard>
  );
}
