import { useThread } from "../thread/store";

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
      className="mb-2 rounded-panel border border-border px-4 py-2 text-sm"
    >
      <ul>
        {lines.map(({ kind, text }, index) => (
          // pi sends the whole queue each time, and the same text can be queued twice.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={index} className="truncate">
            <span className="text-muted-foreground">{kind}:</span> {text}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">↳ Alt+Up to edit all queued messages</p>
    </section>
  );
}
