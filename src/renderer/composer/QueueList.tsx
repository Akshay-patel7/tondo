import { chordLabel } from "../../shared/shortcuts";
import { isMac } from "../platform";
import { useThread } from "../thread/store";
import { Kbd } from "../ui/kbd";

const EDIT_QUEUE = chordLabel({ key: "arrowup", mod: false, shift: false, alt: true }, isMac);

/** The messages you sent while pi works, as pi's last queue_update listed them. */
export function QueueList() {
  const queue = useThread((thread) => thread.queue);
  const lines = [
    ...queue.steering.map((text) => ({ kind: "Steering", text })),
    ...queue.followUp.map((text) => ({ kind: "Follow-up", text })),
  ];
  if (lines.length === 0) return null;

  return (
    <section
      aria-label="Queued messages"
      className="mb-2 rounded-panel border border-border bg-card px-4 py-2.5 text-sm text-card-foreground"
    >
      <ul className="flex flex-col gap-0.5">
        {lines.map(({ kind, text }, index) => (
          // pi sends the whole queue each time, and the same text can be queued twice.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={index} className="truncate">
            <span className="text-muted-foreground">{kind}:</span> {text}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Kbd>{EDIT_QUEUE}</Kbd> to edit all queued messages
      </p>
    </section>
  );
}
