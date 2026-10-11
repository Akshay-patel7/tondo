// The Accounts section: the providers pi is signed in to, which the host reads
// from pi's auth.json as provider ids and kinds only, the Claude usage that
// pi-claude-subscription-connector shows, and sign-in in the thread's sign-in
// terminal: Claude's opens pi's Anthropic menu, and the other leaves pi's own
// /login to pick any provider.
import { CircleAlert, CircleCheck, CircleDashed, LogIn } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import type { OpenThread, PiAccount } from "../../shared/protocol";
import { openTerminal, requestPiAccounts, useHost } from "../connection";
import { useExtensionUi } from "../extensionUi/store";
import { Button } from "../ui/button";
import { Loading, SectionHeading, SettingsGroup } from "./rows";
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

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Accounts"
        description="The providers pi is signed in to. Tondo never reads their tokens or keys."
      />
      {answer === null ? (
        <Loading>Looking for pi's sign-ins…</Loading>
      ) : answer.error === null ? (
        <Accounts accounts={answer.accounts} />
      ) : (
        <SettingsGroup>
          <div className="flex items-start gap-2.5 px-4 py-3.5">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium">Tondo can't list pi's sign-ins</p>
              <p className="text-xs text-muted-foreground">{answer.error}</p>
            </div>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}

function Accounts({ accounts }: { accounts: readonly PiAccount[] }) {
  const reasonId = useId();
  const blocked = useHost((host) => signInBlocked(host.thread));
  const others = accounts.filter((account) => account.provider !== "anthropic");
  return (
    <>
      <SettingsGroup>
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
            <SignInButton variant="outline" blocked={blocked} reasonId={reasonId}>
              Sign in to a provider
            </SignInButton>
          }
        />
      </SettingsGroup>
      {/* Both sign-ins run in the thread's terminal, so one reason covers them. */}
      {blocked === null ? null : (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {blocked}
        </p>
      )}
      {others.length === 0 ? (
        <p className="text-xs text-muted-foreground">pi has no other saved sign-ins.</p>
      ) : null}
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
          variant={account === undefined ? "default" : "outline"}
          blocked={blocked}
          reasonId={reasonId}
        >
          Sign in with Claude
        </SignInButton>
      }
    >
      {usage === undefined ? null : (
        <dl className="flex flex-wrap gap-x-1.5">
          <dt className="font-medium text-foreground">Usage</dt>
          <dd>{usage}</dd>
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
  variant: "default" | "outline";
  blocked: string | null;
  reasonId: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={blocked !== null}
      aria-describedby={blocked === null ? undefined : reasonId}
      onClick={() => {
        closeSettings();
        openTerminal("login", provider);
      }}
    >
      <LogIn aria-hidden />
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
    <div
      role="group"
      aria-labelledby={nameId}
      className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5"
    >
      <div className="flex min-w-56 flex-1 items-start gap-2.5">
        {signedIn ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p id={nameId} className="text-sm font-medium">
            {name}
          </p>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p>{status}</p>
            {children}
          </div>
        </div>
      </div>
      {control}
    </div>
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
