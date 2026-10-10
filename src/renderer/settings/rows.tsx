// What every settings section is made of: a heading, cards of rows, and rows
// with a title, one sentence and a control, as in T3 Code's settings.
import type { ReactNode } from "react";

/** A section's heading, and the sentence that says what it's for. */
export function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** A smaller heading inside a section, over its own card. */
export function GroupHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {description === undefined ? null : (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** A card of rows with a line between each. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-panel border border-border bg-card">
      {children}
    </div>
  );
}

/** One setting: its title and a sentence on the left, its control on the right. */
export function SettingsRow({
  title,
  description,
  control,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <div className="text-sm font-medium">{title}</div>
        {description === undefined ? null : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {control === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      )}
    </div>
  );
}

/** What a section shows until the host has sent the settings. */
export function Loading({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
