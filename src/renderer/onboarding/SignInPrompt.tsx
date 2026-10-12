import { KeyRound } from "lucide-react";
import { useId } from "react";
import { openTerminal } from "../connection";
import { Button } from "../ui/button";
import {
  CardGroup,
  CardGroupRow,
  CardGroupRowDescription,
  CardGroupRowText,
  CardGroupRowTitle,
} from "../ui/card-group";

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
      <CardGroup>
        <CardGroupRow size="sm" className="grid grid-cols-[20px_minmax(0,1fr)_auto]">
          <KeyRound aria-hidden className="size-4 text-muted-foreground" />
          <CardGroupRowText>
            <CardGroupRowTitle>
              <h2 id={titleId}>Sign in to a provider</h2>
            </CardGroupRowTitle>
            <CardGroupRowDescription>
              pi has no model it can use yet. Sign in with /login in the terminal, and Tondo
              refreshes the models when you close it.
            </CardGroupRowDescription>
          </CardGroupRowText>
          <Button onClick={() => openTerminal("login")}>Open sign-in terminal</Button>
        </CardGroupRow>
      </CardGroup>
    </section>
  );
}
