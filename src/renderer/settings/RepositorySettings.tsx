import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { updateSettings, useHost } from "../connection";
import { folderName } from "../format";
import { Button } from "../ui/button";
import { CardGroup } from "../ui/card-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Footnote, Loading, SettingsRow, SubHeading } from "./rows";

export function RepositorySettings() {
  const settings = useHost((host) => host.settings);
  const projects = useHost((host) => host.projects);
  const activeProject = useHost((host) => host.thread?.projectId);
  const [chosen, setChosen] = useState<number | null>(null);
  const id = useId();
  const project = projects.find((item) => item.id === (chosen ?? activeProject)) ?? projects[0];
  if (!settings) return <Loading>Loading settings…</Loading>;
  const override = project ? settings.projectAutoPull[project.path] : null;
  let value = "default";
  if (override != null) value = override ? "on" : "off";
  const options = [
    { value: "default", label: `Use default (${settings.autoPull ? "on" : "off"})` },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ];
  return (
    <>
      <CardGroup>
        <SettingsRow
          title={<label htmlFor={id}>Automatically pull</label>}
          description="Keep the default branch current when the checkout has no local changes or commits. Projects can override it."
          descriptionId={`${id}-description`}
          control={
            <>
              {settings.autoPull === DEFAULT_SETTINGS.autoPull ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset automatic pull"
                  onClick={() => updateSettings({ autoPull: DEFAULT_SETTINGS.autoPull })}
                >
                  <RotateCcw aria-hidden />
                </Button>
              )}
              <Switch
                id={id}
                aria-describedby={`${id}-description`}
                checked={settings.autoPull}
                onCheckedChange={(checked) => updateSettings({ autoPull: checked })}
              />
            </>
          }
        />
      </CardGroup>
      <Footnote>
        Checks the open checkout once a minute. Only fast-forwards, and waits while pi is working or
        a terminal is open in that checkout. Never stashes changes, merges diverged branches or
        pulls feature branches.
      </Footnote>
      <SubHeading title="Project override" />
      {project ? (
        <CardGroup>
          <SettingsRow
            title="Project"
            description={<span className="break-all font-mono">{project.path}</span>}
            control={
              <Select
                value={project.id}
                items={projects.map((item) => ({ value: item.id, label: folderName(item.path) }))}
                onValueChange={setChosen}
              >
                <SelectTrigger aria-label="Repository project" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {folderName(item.path)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Automatically pull this project"
            description="Applies to this project's checkouts. Use default follows the switch above."
            control={
              <Select
                value={value}
                items={options}
                onValueChange={(next) => {
                  if (next !== null)
                    updateSettings({
                      projectAutoPull: {
                        [project.path]: next === "default" ? null : next === "on",
                      },
                    });
                }}
              >
                <SelectTrigger aria-label="Project automatic pull" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </CardGroup>
      ) : (
        <Footnote>Add a project to override automatic pulling for it.</Footnote>
      )}
    </>
  );
}
