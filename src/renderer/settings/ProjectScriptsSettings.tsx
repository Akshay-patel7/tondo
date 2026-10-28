import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import {
  isProjectScript,
  MAX_PROJECT_SCRIPTS,
  type ProjectScript,
} from "../../shared/projectScripts";
import { updateSettings, useHost } from "../connection";
import { folderName } from "../format";
import { Button } from "../ui/button";
import {
  CardGroup,
  CardGroupRow,
  CardGroupRowText,
  CardGroupRowTitle,
  CardGroupRowDescription,
} from "../ui/card-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Footnote, Loading, SettingsRow } from "./rows";

export function ProjectScriptsSettings() {
  const projects = useHost((host) => host.projects);
  const activeProject = useHost((host) => host.thread?.projectId);
  const settings = useHost((host) => host.settings);
  const [chosen, setChosen] = useState<number | null>(null);
  const project = projects.find((item) => item.id === (chosen ?? activeProject)) ?? projects[0];
  if (!settings) return <Loading>Loading settings…</Loading>;
  if (!project) return <Footnote>Add a project to configure its scripts.</Footnote>;
  return (
    <>
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
              <SelectTrigger aria-label="Script project" className="w-48">
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
      </CardGroup>
      <ScriptList
        key={project.path}
        folder={project.path}
        scripts={settings.projectScripts[project.path] ?? []}
      />
    </>
  );
}

function ScriptList({ folder, scripts }: { folder: string; scripts: readonly ProjectScript[] }) {
  const [editing, setEditing] = useState<ProjectScript | "new" | null>(null);
  const save = (next: readonly ProjectScript[]) =>
    updateSettings({ projectScripts: { [folder]: next } });
  return (
    <>
      {scripts.length ? (
        <CardGroup>
          {scripts.map((script) => (
            <CardGroupRow key={script.id}>
              <CardGroupRowText>
                <CardGroupRowTitle className="break-all">{script.name}</CardGroupRowTitle>
                <CardGroupRowDescription className="whitespace-pre-wrap break-all">
                  <span className="font-mono">{script.command}</span>
                </CardGroupRowDescription>
              </CardGroupRowText>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${script.name}`}
                  onClick={() => setEditing(script)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${script.name}`}
                  onClick={() => save(scripts.filter((item) => item.id !== script.id))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </CardGroupRow>
          ))}
        </CardGroup>
      ) : (
        <Footnote>No scripts yet. Add a command such as pnpm build.</Footnote>
      )}
      <Button
        variant="neutral"
        className="self-start"
        disabled={scripts.length >= MAX_PROJECT_SCRIPTS}
        onClick={() => setEditing("new")}
      >
        <Plus aria-hidden />
        Add script
      </Button>
      <Footnote>
        Each run opens a separate terminal in the checkout shown in the thread header. Existing
        terminals stay untouched. Script output is not automatically shared with chat. Keep up to{" "}
        {MAX_PROJECT_SCRIPTS} scripts per project.
      </Footnote>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null ? (
          <ScriptEditor
            key={editing === "new" ? "new" : editing.id}
            script={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={(script) => {
              save(
                editing === "new"
                  ? [...scripts, script]
                  : scripts.map((item) => (item.id === script.id ? script : item)),
              );
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function ScriptEditor({
  script,
  onSave,
  onCancel,
}: {
  script: ProjectScript | null;
  onSave: (script: ProjectScript) => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const commandId = useId();
  const [id] = useState(() => script?.id ?? crypto.randomUUID());
  const [name, setName] = useState(script?.name ?? "");
  const [command, setCommand] = useState(script?.command ?? "");
  const next = { id, name: name.trim(), command };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{script ? "Edit script" : "Add script"}</DialogTitle>
        <DialogDescription>
          Run a shell command from this project's thread header. Only save commands you trust.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (isProjectScript(next)) onSave(next);
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onValueChange={setName}
            maxLength={80}
            placeholder="Build app"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={commandId}>Command</Label>
          <Textarea
            id={commandId}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            maxLength={8192}
            placeholder="pnpm build"
            rows={4}
            required
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isProjectScript(next)}>
            Save script
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
