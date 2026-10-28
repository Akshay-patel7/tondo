// The Threads section: new-session defaults, process limits and worktree location.
import { FolderOpen } from "lucide-react";
import { useId, useState } from "react";
import {
  isPoolValue,
  POOL_RANGES,
  type AppSettings,
  type PoolSettings,
} from "../../shared/settings";
import { chooseWorktreeDirectory, updateSettings, useHost } from "../connection";
import { Button } from "../ui/button";
import { CardGroup } from "../ui/card-group";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Footnote, Loading, SettingsRow, SubHeading } from "./rows";
import { ThreadDefaults } from "./ThreadDefaults";
import { IdeSettings } from "./IdeSettings";

export function ThreadSettings() {
  const settings = useHost((host) => host.settings);
  if (settings === null) return <Loading>Loading settings…</Loading>;
  const { maxLive, idleMinutes } = POOL_RANGES;
  return (
    <>
      <ThreadDefaults settings={settings} />
      <SubHeading title="Open in IDE" description="Choose the editor used by the thread header." />
      <IdeSettings key={settings.ideCommand} command={settings.ideCommand} />
      <SubHeading
        title="Process limits"
        description="Control how many idle threads keep pi running."
      />
      <CardGroup>
        <PoolRow
          settings={settings}
          field="maxLive"
          title="pi processes kept running"
          description={`When more are running, Tondo stops the pi of the thread you used longest ago. ${maxLive.min}–${maxLive.max}.`}
          fewer="Fewer pi processes"
          more="More pi processes"
        />
        <PoolRow
          settings={settings}
          field="idleMinutes"
          title="Stop a hidden idle thread's pi after"
          description={`Come back to a thread sooner, and its pi is still running. ${idleMinutes.min}–${idleMinutes.max} minutes.`}
          unit="min"
          fewer="Fewer minutes"
          more="More minutes"
        />
      </CardGroup>
      <Footnote>The thread on screen and threads where pi is busy never stop.</Footnote>
      <SubHeading
        title="Worktrees"
        description="Choose where Tondo creates new worktree folders. Existing worktrees stay where they are."
      />
      <WorktreeLocation directory={settings.worktreeDirectory} />
    </>
  );
}

function WorktreeLocation({ directory }: { directory: string | null }) {
  const chooseId = useId();
  const descriptionId = useId();
  return (
    <CardGroup>
      <SettingsRow
        title="Worktree location"
        descriptionId={descriptionId}
        description={
          directory === null ? (
            "Default: worktrees in Tondo's app data folder."
          ) : (
            <span className="font-mono break-all">{directory}</span>
          )
        }
        control={
          <>
            <Button
              id={chooseId}
              variant="neutral"
              aria-describedby={descriptionId}
              onClick={() => chooseWorktreeDirectory()}
            >
              <FolderOpen aria-hidden />
              Choose folder…
            </Button>
            {directory === null ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  updateSettings({ worktreeDirectory: null });
                  document.getElementById(chooseId)?.focus();
                }}
              >
                Use default
              </Button>
            )}
          </>
        }
      />
    </CardGroup>
  );
}

/** A pool limit, saved when you leave the field, step it or press its arrows. */
function PoolRow({
  settings,
  field,
  title,
  description,
  unit,
  fewer,
  more,
}: {
  settings: AppSettings;
  field: keyof PoolSettings;
  title: string;
  description: string;
  unit?: string;
  fewer: string;
  more: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const saved = settings.pool[field];
  // What you typed lasts until the host answers with new settings, which hold
  // the value it saved, or the old one if it refused.
  const [draft, setDraft] = useState<{
    readonly value: number | null;
    readonly from: AppSettings;
  } | null>(null);
  const value = draft !== null && draft.from === settings ? draft.value : saved;
  const { min, max } = POOL_RANGES[field];
  return (
    <SettingsRow
      title={<label htmlFor={id}>{title}</label>}
      description={description}
      descriptionId={descriptionId}
      control={
        <>
          <NumberField
            id={id}
            className="w-fit"
            value={value}
            min={min}
            max={max}
            onValueChange={(next) => setDraft({ value: next, from: settings })}
            onValueCommitted={(next) => {
              if (next !== saved && isPoolValue(field, next)) {
                updateSettings({ pool: { [field]: next } });
              } else {
                setDraft(null);
              }
            }}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label={fewer} />
              <NumberFieldInput aria-describedby={descriptionId} />
              <NumberFieldIncrement aria-label={more} />
            </NumberFieldGroup>
          </NumberField>
          {unit === undefined ? null : (
            <span className="text-xs text-faint-foreground">{unit}</span>
          )}
        </>
      }
    />
  );
}
