import { useId, useState } from "react";
import { updateSettings, useHost, useRemoteStatus } from "../connection";
import {
  CardGroup,
  CardGroupRow,
  CardGroupRowText,
  CardGroupRowTitle,
  CardGroupRowDescription,
} from "../ui/card-group";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Footnote, Loading, SettingsRow } from "./rows";

export function RemoteAccessSettings() {
  const enabled = useHost((host) => host.settings?.remoteAccess);
  const status = useRemoteStatus();
  const id = useId();
  if (enabled === undefined) return <Loading>Loading settings…</Loading>;
  return (
    <>
      <CardGroup>
        <SettingsRow
          title={<label htmlFor={id}>Remote access</label>}
          description="Use Tondo from your iPhone through your private Tailscale network. Off means no remote server."
          control={
            <Switch
              id={id}
              checked={enabled}
              onCheckedChange={(checked) => updateSettings({ remoteAccess: checked })}
            />
          }
        />
        {enabled && status.state === "ready" ? (
          <>
            <CopyRow
              key={status.code}
              title="Pairing code"
              value={status.code}
              description="Enter this in Safari. Keep it private: a paired browser can control your coding agents."
            />
            <SettingsRow
              title="Local server"
              description={`Listening only on http://127.0.0.1:${status.port}. No router ports are opened.`}
            />
          </>
        ) : null}
      </CardGroup>
      {enabled && status.state === "starting" ? (
        <Footnote>Starting the remote gateway…</Footnote>
      ) : null}
      {enabled && status.state === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Remote access couldn't start</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      ) : null}
      <Footnote>
        Install Tailscale on your Mac and iPhone, signed into the same network. Tondo never changes
        your Tailscale configuration.
      </Footnote>
      {enabled && status.state === "ready" ? (
        <>
          <CardGroup>
            <CopyRow
              title="Tailscale Serve command"
              value={`tailscale serve --bg http://127.0.0.1:${status.port}`}
              description="Review your existing Serve configuration first; this command changes its HTTPS handler. Use Serve, not public Funnel."
            />
          </CardGroup>
          <Footnote>
            Open the private HTTPS URL printed by Tailscale in Safari and enter the pairing code.
            Your Mac must stay awake, online and running Tondo.
          </Footnote>
        </>
      ) : null}
      <Footnote>
        Turning this off disconnects every browser. Restarting Tondo or turning remote access off
        and on changes the pairing code and revokes paired sessions. Your separate Tailscale Serve
        route is left untouched.
      </Footnote>
    </>
  );
}

function CopyRow({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  function copy(): void {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setError(false);
      },
      () => setError(true),
    );
  }
  return (
    <CardGroupRow className="flex-col items-stretch">
      <CardGroupRowText>
        <CardGroupRowTitle>
          <label htmlFor={id}>{title}</label>
        </CardGroupRowTitle>
        <CardGroupRowDescription>{description}</CardGroupRowDescription>
      </CardGroupRowText>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-label={title}
          readOnly
          value={value}
          className="min-w-0 flex-1"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="outline" onClick={copy} aria-label={`Copy ${title.toLowerCase()}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {error ? <Footnote>Couldn't copy. Select the text and copy it manually.</Footnote> : null}
    </CardGroupRow>
  );
}
