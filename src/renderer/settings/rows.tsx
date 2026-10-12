// What every settings section is made of besides its heading, which
// SettingsPage draws: cards of rows (ui/card-group), each row a title, one
// sentence and a control, and the smaller headings and notes between cards.
import type { ReactNode } from "react";
import {
  CardGroupRow,
  CardGroupRowDescription,
  CardGroupRowText,
  CardGroupRowTitle,
} from "../ui/card-group";

/** One setting in a CardGroup: its title and a sentence on the left, its control on the right. */
export function SettingsRow({
  title,
  titleId,
  description,
  descriptionId,
  control,
}: {
  title: ReactNode;
  /** For a control that takes its name from the title, such as a segmented control. */
  titleId?: string;
  description?: ReactNode;
  /** For a control that the sentence describes. */
  descriptionId?: string;
  control?: ReactNode;
}) {
  return (
    <CardGroupRow>
      <CardGroupRowText className="min-w-55">
        <CardGroupRowTitle id={titleId}>{title}</CardGroupRowTitle>
        {description === undefined ? null : (
          <CardGroupRowDescription id={descriptionId}>{description}</CardGroupRowDescription>
        )}
      </CardGroupRowText>
      {control === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      )}
    </CardGroupRow>
  );
}

/** A smaller heading inside a section, over its own card. */
export function SubHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="font-medium">{title}</h3>
      {description === undefined ? null : (
        <p className="text-xs text-faint-foreground">{description}</p>
      )}
    </div>
  );
}

/** A sentence under a section's card. */
export function Footnote({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-faint-foreground">
      {children}
    </p>
  );
}

/** What a section shows until the host has sent what it needs. */
export function Loading({ children }: { children: string }) {
  return <p className="text-muted-foreground">{children}</p>;
}
