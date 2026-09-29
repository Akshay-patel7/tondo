// The model and thinking level pickers. They're native selects until Stage 12
// brings Base UI. They show what pi last reported, and a pick goes to pi,
// which reports the change back.
import type { ReactNode } from "react";
import type { PiSession, ThinkingLevel } from "../../shared/protocol";
import { setModel, setThinkingLevel } from "../connection";

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Thinking off",
  minimal: "Minimal thinking",
  low: "Low thinking",
  medium: "Medium thinking",
  high: "High thinking",
  xhigh: "Extra high thinking",
  max: "Max thinking",
};

function Picker({
  name,
  label,
  value,
  onChange,
  children,
}: {
  /** What /model and /thinking find the picker by. */
  name: "model" | "thinking";
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        data-picker={name}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-56 appearance-none truncate rounded-control bg-transparent py-1 pr-6 pl-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 size-3 text-muted-foreground"
      >
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

/** A model's value in the picker. */
function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function ModelPicker({ session }: { session: PiSession }) {
  const { model, models } = session;
  const current = model ? modelKey(model.provider, model.id) : "";
  const listed = models.some((option) => modelKey(option.provider, option.id) === current);
  const providers = [...new Set(models.map((option) => option.provider))];

  const pick = (value: string) => {
    const picked = models.find((option) => modelKey(option.provider, option.id) === value);
    if (picked) setModel(picked.provider, picked.id);
  };

  return (
    <Picker name="model" label="Model" value={current} onChange={pick}>
      {listed ? null : (
        // pi's model isn't one you have credentials for, or pi has none.
        <option value={current} disabled>
          {current || "No model"}
        </option>
      )}
      {providers.map((provider) => (
        <optgroup key={provider} label={provider}>
          {models
            .filter((option) => option.provider === provider)
            .map((option) => (
              <option key={option.id} value={modelKey(provider, option.id)}>
                {option.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Picker>
  );
}

export function ThinkingPicker({ session }: { session: PiSession }) {
  const { thinkingLevel, thinkingLevels } = session;
  // A model without reasoning offers only "off".
  if (thinkingLevels.length < 2) return null;

  const pick = (value: string) => {
    const level = thinkingLevels.find((option) => option === value);
    if (level) setThinkingLevel(level);
  };

  return (
    <Picker name="thinking" label="Thinking level" value={thinkingLevel} onChange={pick}>
      {thinkingLevels.map((level) => (
        <option key={level} value={level}>
          {THINKING_LABELS[level]}
        </option>
      ))}
    </Picker>
  );
}
