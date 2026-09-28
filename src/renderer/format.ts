// formatTokens and formatPercent are adapted from T3 Code: formatContextWindowTokens
// in apps/web/src/lib/contextWindow.ts and formatPercentage in
// apps/web/src/components/chat/ContextWindowMeter.tsx. formatAge follows
// formatRelativeTime in apps/web/src/timestampFormat.ts, shortened the way
// compactSidebarTimeLabel in apps/web/src/components/Sidebar.tsx shortens it.
// Copyright (c) 2026 T3 Tools Inc. MIT License.

/** The last part of a folder path. */
export function folderName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}

/** A token count in a few characters: 950, 1.2k, 45k, 1.5m. */
export function formatTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** A percentage with one decimal below 10%: 0.4%, 9.5%, 12%. */
export function formatPercent(value: number): string {
  if (value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago `time` was, in a few characters: now, 5m, 3h, 2d, 3w, 4mo, 2y. */
export function formatAge(time: number, now: number): string {
  const age = Math.max(0, now - time);
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  const days = Math.floor(age / DAY);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
