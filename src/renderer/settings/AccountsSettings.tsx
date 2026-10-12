// The Accounts section: the providers pi is signed in to, which the host reads
// from pi's auth.json as provider ids and kinds only, the Claude usage that
// pi-claude-subscription-connector shows, and sign-in in the thread's sign-in
// terminal: Claude's opens pi's Anthropic menu, and the other leaves pi's own
// /login to pick any provider.
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import type { OpenThread, PiAccount } from "../../shared/protocol";
import { openTerminal, requestPiAccounts, useHost } from "../connection";
import { useExtensionUi } from "../extensionUi/store";
import { Button } from "../ui/button";
import {
  CardGroup,
  CardGroupRow,
  CardGroupRowDescription,
  CardGroupRowText,
  CardGroupRowTitle,
} from "../ui/card-group";
import { Footnote, Loading } from "./rows";
import { closeSettings } from "./store";

/** The status pi-claude-subscription-connector shows Claude's usage in, while a thread uses Claude over OAuth. */
const CLAUDE_USAGE = "0-claude-max";

const PROVIDER_NAMES: ReadonlyMap<string, string> = new Map([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["openai-codex", "OpenAI Codex"],
  ["github-copilot", "GitHub Copilot"],
  ["google-gemini-cli", "Google Gemini CLI"],
  ["google-antigravity", "Antigravity"],
  ["openrouter", "OpenRouter"],
]);

export function AccountsSettings() {
  const answer = useHost((host) => host.piAccounts);

  // You sign in and out in pi's terminal, so each visit reads auth.json again.
  useEffect(() => {
    requestPiAccounts();
  }, []);

  if (answer === null) return <Loading>Looking for pi's sign-ins…</Loading>;
  if (answer.error === null) return <Accounts accounts={answer.accounts} />;
  return (
    <CardGroup>
      <CardGroupRow className="grid grid-cols-[16px_minmax(0,1fr)_auto]">
        <CircleAlert aria-hidden className="mt-px size-4 self-start text-destructive" />
        <CardGroupRowText>
          <CardGroupRowTitle>Tondo can't list pi's sign-ins</CardGroupRowTitle>
          <p className="text-xs text-muted-foreground">{answer.error}</p>
        </CardGroupRowText>
      </CardGroupRow>
    </CardGroup>
  );
}

function Accounts({ accounts }: { accounts: readonly PiAccount[] }) {
  const reasonId = useId();
  const blocked = useHost((host) => signInBlocked(host.thread));
  const others = accounts.filter((account) => account.provider !== "anthropic");
  return (
    <>
      <CardGroup>
        <AnthropicAccount
          account={accounts.find((account) => account.provider === "anthropic")}
          blocked={blocked}
          reasonId={reasonId}
        />
        {others.map((account) => (
          <AccountRow
            key={account.provider}
            name={PROVIDER_NAMES.get(account.provider) ?? account.provider}
            status={signInKind(account.type)}
            signedIn
          />
        ))}
        <AccountRow
          name="Other providers"
          status="Run /login in the sign-in terminal to pick one."
          signedIn={false}
          control={
            <SignInButton variant="neutral" blocked={blocked} reasonId={reasonId}>
              Sign in to a provider
            </SignInButton>
          }
        />
      </CardGroup>
      {/* Both sign-ins run in the thread's terminal, so one reason covers them. */}
      {blocked === null ? null : <Footnote id={reasonId}>{blocked}</Footnote>}
      {others.length === 0 ? <Footnote>pi has no other saved sign-ins.</Footnote> : null}
    </>
  );
}

function AnthropicAccount({
  account,
  blocked,
  reasonId,
}: {
  account: PiAccount | undefined;
  blocked: string | null;
  reasonId: string;
}) {
  const usage = useExtensionUi(
    (ui) => ui.statuses.find((status) => status.key === CLAUDE_USAGE)?.text,
  );
  return (
    <AccountRow
      name="Anthropic"
      status={anthropicSignIn(account)}
      signedIn={account !== undefined}
      control={
        <SignInButton
          provider="anthropic"
          variant={account === undefined ? "default" : "neutral"}
          blocked={blocked}
          reasonId={reasonId}
        >
          Sign in with Claude
        </SignInButton>
      }
    >
      {usage === undefined ? null : (
        <dl className="flex flex-wrap gap-x-1 text-xs text-muted-foreground">
          <dt>Usage</dt>
          <dd>
            <span aria-hidden>·</span> {usage}
          </dd>
        </dl>
      )}
    </AccountRow>
  );
}

/**
 * Closes Settings and opens pi in the thread's sign-in terminal, on the menu
 * for `provider` if you name one. Without one, pi's own /login picks any.
 */
function SignInButton({
  provider,
  variant,
  blocked,
  reasonId,
  children,
}: {
  provider?: string;
  variant: "default" | "neutral";
  blocked: string | null;
  reasonId: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      disabled={blocked !== null}
      aria-describedby={blocked === null ? undefined : reasonId}
      onClick={() => {
        closeSettings();
        openTerminal("login", provider);
      }}
    >
      {children}
    </Button>
  );
}

function AccountRow({
  name,
  status,
  signedIn,
  control,
  children,
}: {
  name: string;
  status: string;
  signedIn: boolean;
  control?: ReactNode;
  children?: ReactNode;
}) {
  const nameId = useId();
  return (
    // A 16px status icon, the text and the action. With the row's 16px gap, the
    // text starts 48px in, as in the handoff's 20px column and 12px gap.
    <CardGroupRow
      role="group"
      aria-labelledby={nameId}
      className="grid grid-cols-[16px_minmax(0,1fr)_auto]"
    >
      {signedIn ? (
        <CircleCheck aria-hidden className="mt-px size-4 self-start text-success" />
      ) : (
        <CircleDashed aria-hidden className="mt-px size-4 self-start text-faint-foreground" />
      )}
      <CardGroupRowText>
        <CardGroupRowTitle id={nameId}>{name}</CardGroupRowTitle>
        <CardGroupRowDescription>{status}</CardGroupRowDescription>
        {children}
      </CardGroupRowText>
      {control}
    </CardGroupRow>
  );
}

function anthropicSignIn(account: PiAccount | undefined): string {
  if (account === undefined) return "Not signed in";
  switch (account.type) {
    case "oauth":
      return "Claude Pro/Max subscription";
    case "api_key":
      return "API key";
  }
}

function signInKind(type: PiAccount["type"]): string {
  switch (type) {
    case "oauth":
      return "Signed in with an account";
    case "api_key":
      return "API key";
  }
}

/** Why the thread on screen can't open its sign-in terminal, or null if it can. */
function signInBlocked(thread: OpenThread | null): string | null {
  if (thread === null) return "Open a thread first. pi's sign-in runs in the thread's terminal.";
  if (thread.askingTrust) return "Answer whether to trust this thread's project first.";
  return null;
}
