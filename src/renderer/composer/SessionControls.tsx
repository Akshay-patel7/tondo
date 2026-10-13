// The model and thinking level pickers. They show what pi last reported, and a
// pick goes to pi, which reports the change back.
import type { PiSession, ThinkingLevel } from "../../shared/protocol";
import { setModel, setThinkingLevel, usePiUpdates } from "../connection";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Thinking off",
  minimal: "Minimal thinking",
  low: "Low thinking",
  medium: "Medium thinking",
  high: "High thinking",
  xhigh: "Extra high thinking",
  max: "Max thinking",
};

/** A model's value in the picker. */
function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

// Each trigger keeps data-picker, which /model and /thinking find it by (slash/builtins.ts).
export function ModelPicker({ session }: { session: PiSession }) {
  const updating = usePiUpdates((updates) => updates.updating);
  const { model, models } = session;
  const current = model ? modelKey(model.provider, model.id) : null;
  const listed = models.some((option) => modelKey(option.provider, option.id) === current);
  const providers = [...new Set(models.map((option) => option.provider))];
  // pi's model isn't one you have credentials for. It shows, but you can't pick it.
  const unlisted = models.length > 0 && current !== null && !listed ? current : null;
  const labels: Record<string, string> = Object.fromEntries([
    ...(unlisted === null ? [] : [[unlisted, unlisted]]),
    ...models.map((option) => [modelKey(option.provider, option.id), option.name]),
  ]);

  const pick = (value: string | null) => {
    const picked = models.find((option) => modelKey(option.provider, option.id) === value);
    if (picked) setModel(picked.provider, picked.id);
  };

  // With no models to pick from, the picker says so rather than naming the
  // model pi falls back to.
  return (
    <Select
      items={labels}
      value={models.length === 0 ? null : current}
      onValueChange={pick}
      disabled={models.length === 0 || updating}
    >
      <SelectTrigger
        data-picker="model"
        aria-label="Model"
        variant="ghost-picker"
        className="max-w-56"
      >
        <SelectValue placeholder="No model" />
      </SelectTrigger>
      <SelectContent>
        {unlisted === null ? null : (
          <SelectItem value={unlisted} disabled>
            {unlisted}
          </SelectItem>
        )}
        {providers.map((provider) => (
          <SelectGroup key={provider}>
            <SelectGroupLabel>{provider}</SelectGroupLabel>
            {models
              .filter((option) => option.provider === provider)
              .map((option) => (
                <SelectItem key={option.id} value={modelKey(provider, option.id)}>
                  {option.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ThinkingPicker({ session }: { session: PiSession }) {
  const updating = usePiUpdates((updates) => updates.updating);
  const { thinkingLevel, thinkingLevels } = session;
  // A model without reasoning offers only "off".
  if (thinkingLevels.length < 2) return null;

  const pick = (value: string | null) => {
    const level = thinkingLevels.find((option) => option === value);
    if (level) setThinkingLevel(level);
  };

  return (
    <Select
      items={thinkingLevels.map((level) => ({ value: level, label: THINKING_LABELS[level] }))}
      value={thinkingLevel}
      onValueChange={pick}
      disabled={updating}
    >
      <SelectTrigger data-picker="thinking" aria-label="Thinking level" variant="ghost-picker">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {thinkingLevels.map((level) => (
          <SelectItem key={level} value={level}>
            {THINKING_LABELS[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
