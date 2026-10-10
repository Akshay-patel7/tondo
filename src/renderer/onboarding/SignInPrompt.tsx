import { KeyRound } from "lucide-react";
import { useId } from "react";
import { openTerminal } from "../connection";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

/**
 * Above the composer while pi has no model you have credentials for. pi reads
 * credentials only as it starts, so the host reloads the thread's pi when the
 * sign-in terminal closes.
 */
export function SignInPrompt() {
  const titleId = useId();
  // Its own compositing layer, like the composer card under it, so the page's
  // layer stays one solid color.
  return (
    <section aria-labelledby={titleId} className="mb-2 will-change-transform">
      <Alert variant="info">
        <KeyRound aria-hidden />
        <AlertTitle>
          <h2 id={titleId}>Sign in to a provider</h2>
        </AlertTitle>
        <AlertDescription>
          pi has no model it can use yet. Sign in with /login in the terminal, and Tondo refreshes
          the models when you close it.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" onClick={() => openTerminal("login")}>
            Open sign-in terminal
          </Button>
        </AlertAction>
      </Alert>
    </section>
  );
}
