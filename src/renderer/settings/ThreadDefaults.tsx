// New-session defaults. The open thread supplies pi's available model list;
// changing these preferences never changes that thread's session.
import { useId } from "react";
import { isThinkingLevel, THINKING_LABELS, type AppSettings } from "../../shared/settings";
import { updateSettings, useHost } from "../connection";
import { CardGroup } from "../ui/card-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SettingsRow } from "./rows";

const PI_DEFAULT = "pi-default";

export function ThreadDefaults({ settings }: { settings: AppSettings }) {
  const session = useHost((host) =>
    host.thread?.pi.state === "ready" ? host.thread.pi.session : null,
  );
  const modelDescription = useId();
  const thinkingDescription = useId();
  const models = session?.models ?? [];
  const chosen = settings.defaultModel;
  const current = chosen ? `${chosen.provider}/${chosen.id}` : PI_DEFAULT;
  const unlisted =
    chosen !== null &&
    !models.some((model) => model.provider === chosen.provider && model.id === chosen.id);
  const providers = [...new Set(models.map((model) => model.provider))];
  const labels = Object.fromEntries([
    [PI_DEFAULT, "Use pi's default"],
    ...models.map((model) => [`${model.provider}/${model.id}`, model.name]),
    ...(unlisted ? [[current, current]] : []),
  ]);
  const thinkingItems = [
    { value: PI_DEFAULT, label: "Use pi's default" },
    ...Object.entries(THINKING_LABELS).map(([value, label]) => ({ value, label })),
  ];

  return (
    <CardGroup>
      <SettingsRow
        title="Default model"
        descriptionId={modelDescription}
        description={
          models.length === 0
            ? "Open a thread with a signed-in provider to list available models."
            : "The model new threads start with. Existing threads keep their model."
        }
        control={
          <Select
            items={labels}
            value={current}
            onValueChange={(value) => {
              if (value === PI_DEFAULT) updateSettings({ defaultModel: null });
              else {
                const model = models.find((option) => `${option.provider}/${option.id}` === value);
                if (model)
                  updateSettings({ defaultModel: { provider: model.provider, id: model.id } });
              }
            }}
          >
            <SelectTrigger
              aria-label="Default model"
              aria-describedby={modelDescription}
              className="max-w-64"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PI_DEFAULT}>Use pi's default</SelectItem>
              {unlisted ? (
                <SelectItem value={current} disabled>
                  {current} (unavailable)
                </SelectItem>
              ) : null}
              {providers.map((provider) => (
                <SelectGroup key={provider}>
                  <SelectGroupLabel>{provider}</SelectGroupLabel>
                  {models
                    .filter((model) => model.provider === provider)
                    .map((model) => (
                      <SelectItem key={model.id} value={`${provider}/${model.id}`}>
                        {model.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        title="Default thinking level"
        descriptionId={thinkingDescription}
        description="For new threads only. pi adjusts this to a level the model supports."
        control={
          <Select
            items={thinkingItems}
            value={settings.defaultThinkingLevel ?? PI_DEFAULT}
            onValueChange={(value) => {
              if (value === PI_DEFAULT) updateSettings({ defaultThinkingLevel: null });
              else if (isThinkingLevel(value)) updateSettings({ defaultThinkingLevel: value });
            }}
          >
            <SelectTrigger
              aria-label="Default thinking level"
              aria-describedby={thinkingDescription}
              className="max-w-64"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {thinkingItems.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </CardGroup>
  );
}
