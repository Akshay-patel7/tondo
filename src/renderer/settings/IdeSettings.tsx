import { useId, useState } from "react";
import { IDE_PRESETS, isIdeCommand } from "../../shared/ide";
import { updateSettings } from "../connection";
import { CardGroup } from "../ui/card-group";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./rows";

const ITEMS = [
  ...IDE_PRESETS.map(({ command, label }) => ({ value: command, label })),
  { value: "custom", label: "Custom executable" },
];

export function IdeSettings({ command }: { command: string }) {
  const descriptionId = useId();
  const executableDescriptionId = useId();
  const preset = IDE_PRESETS.some((item) => item.command === command);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const showCustom = custom || !preset;
  const value = draft ?? (preset ? "" : command);
  const invalid = draft !== null && !isIdeCommand(value);
  const save = () => {
    if (isIdeCommand(value) && value !== command) updateSettings({ ideCommand: value });
  };
  return (
    <CardGroup>
      <SettingsRow
        title="IDE"
        descriptionId={descriptionId}
        description="Open the folder shown in the thread header, including a detected agent worktree. macOS presets use the installed app; Linux presets use its command on PATH."
        control={
          <Select
            items={ITEMS}
            value={showCustom ? "custom" : command}
            onValueChange={(next) => {
              if (next === "custom") setCustom(true);
              else if (next !== null) {
                setCustom(false);
                setDraft(null);
                updateSettings({ ideCommand: next });
              }
            }}
          >
            <SelectTrigger aria-label="IDE" aria-describedby={descriptionId} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEMS.map(({ value: option, label }) => (
                <SelectItem key={option} value={option}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {showCustom ? (
        <SettingsRow
          title="IDE executable"
          descriptionId={executableDescriptionId}
          description={
            invalid
              ? "Enter one executable name or absolute path, without arguments or shell syntax. The saved IDE has not changed."
              : "An executable name on PATH or an absolute path, without arguments or shell syntax. Saves on Enter or when you leave the field."
          }
          control={
            <Input
              aria-label="IDE executable"
              aria-describedby={executableDescriptionId}
              aria-invalid={invalid}
              placeholder="/path/to/ide"
              className="w-64"
              value={value}
              onValueChange={setDraft}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          }
        />
      ) : null}
    </CardGroup>
  );
}
