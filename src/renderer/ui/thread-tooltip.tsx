// Layout adapted from T3 Code's apps/web/src/components/Sidebar.tsx.
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License.
import { Cpu } from "lucide-react";
import { TooltipContent } from "./tooltip";

/** The full title wraps instead of inheriting the sidebar row's truncation. */
export function ThreadTooltipContent({ title, model }: { title: string; model: string | null }) {
  return (
    <TooltipContent side="right" align="start" variant="card">
      <p className="w-full text-sm font-medium wrap-anywhere">{title}</p>
      <div className="flex w-full items-start gap-2 text-xs text-muted-foreground">
        <Cpu aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 wrap-anywhere">{model ?? "Model unknown"}</span>
      </div>
    </TooltipContent>
  );
}
