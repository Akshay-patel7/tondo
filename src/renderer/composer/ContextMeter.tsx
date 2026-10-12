// The ring is adapted from T3 Code,
// apps/web/src/components/chat/ContextWindowMeter.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { PiSession } from "../../shared/protocol";
import { formatPercent, formatTokens } from "../format";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Above this share of the window, the ring turns red. */
const NEARLY_FULL = 90;

/**
 * How much of the model's context window the conversation fills, from pi's
 * get_session_stats: a 16px ring and the percentage. It takes keyboard focus
 * so the token counts in its tooltip reach the keyboard too, and screen
 * readers hear them as its description.
 */
export function ContextMeter({ context }: { context: NonNullable<PiSession["context"]> }) {
  const { tokens, contextWindow, percent } = context;
  const filled = Math.max(0, Math.min(100, percent ?? 0));
  // pi doesn't know the usage right after compacting, until the next reply.
  const label =
    percent === null
      ? "Context window use unknown"
      : `Context window ${formatPercent(percent)} used`;
  const detail =
    tokens === null
      ? `${formatTokens(contextWindow)} token window. pi counts again after its next reply.`
      : `${formatTokens(tokens)} of ${formatTokens(contextWindow)} tokens`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={label}
            aria-description={detail}
            className="flex h-7 items-center gap-1 rounded-chip text-2xs text-faint-foreground tabular-nums focus-visible:focus-ring"
          />
        }
      >
        <svg viewBox="0 0 24 24" className="size-4 -rotate-90" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            className="stroke-foreground/10"
          />
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - filled / 100)}
            className={filled > NEARLY_FULL ? "stroke-destructive" : "stroke-muted-foreground"}
          />
        </svg>
        {percent === null ? null : formatPercent(percent)}
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col">
          <span>{label}</span>
          <span className="text-muted-foreground">{detail}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
