import { ChevronDown, ChevronRight } from "lucide-react";
import { useId } from "react";
import { toolRun } from "../../shared/thread";
import { useThread } from "../thread/store";
import { formatDuration, toolResults, workLogDuration } from "../tools/model";
import { ToolRow } from "../tools/ToolRow";
import type { StackItem } from "./turns";
import { toggleWorkLog, useCollapsedWorkLogs } from "./collapsedWorkLogs";

export type WorkLogItem = Extract<StackItem, { kind: "workLog" }>;

/**
 * The card that groups a turn's run of tool calls. Its header collapses the
 * list, and each row opens to its call's output. The header says how long
 * the calls took once they all have results.
 */
export function WorkLog({ log }: { log: WorkLogItem }) {
  const collapsed = useCollapsedWorkLogs((keys) => keys.has(log.key));
  const calls = log.calls.map(({ call }) => call);
  const working = useThread(
    (thread) =>
      thread.running &&
      calls.some(
        (call) => !toolResults(thread.messages).has(call.id) && !toolRun(thread, call.id)?.result,
      ),
  );
  const duration = useThread((thread) =>
    working ? null : workLogDuration(log.startedAt, calls, toolResults(thread.messages)),
  );
  const listId = useId();
  const title = working
    ? "Working"
    : duration === null
      ? "Worked"
      : `Worked for ${formatDuration(duration)}`;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="rounded-card border border-border bg-sidebar" data-work-log={log.key}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : listId}
        onClick={() => toggleWorkLog(log.key)}
        className="flex h-9 w-full items-center gap-2 rounded-[calc(var(--card-radius)-1px)] px-3 text-left text-xs text-faint-foreground outline-none hover:bg-accent focus-visible:focus-ring aria-expanded:rounded-b-none"
      >
        <Chevron aria-hidden className="size-3 shrink-0" />
        {/* The spaces keep the parts apart in the button's name. The flex row doesn't draw them. */}
        <span className="font-medium text-foreground">{title}</span>{" "}
        <span>{`· ${log.calls.length} tool ${log.calls.length === 1 ? "call" : "calls"}`}</span>
      </button>
      {collapsed ? null : (
        <div
          id={listId}
          className="flex flex-col overflow-hidden rounded-b-[calc(var(--card-radius)-1px)] border-t border-border py-1"
        >
          {log.calls.map(({ call, writing }) => (
            <ToolRow key={call.id} call={call} writing={writing} />
          ))}
        </div>
      )}
    </div>
  );
}
