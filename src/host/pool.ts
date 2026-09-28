// Decides which threads' pi processes to stop, so that memory doesn't grow
// with every thread you open. A real pi settles at about 212 MiB (docs/stack.md),
// so four of them hold about 850 MiB.

export interface PoolMember {
  readonly id: string;
  /** Whether pi is starting, answering, compacting, retrying or holding queued messages for the thread. */
  readonly busy: boolean;
  /** Whether the thread is on screen. */
  readonly visible: boolean;
  /** When you last looked at the thread or pi last finished something in it. */
  readonly lastUsed: number;
}

export interface PoolLimits {
  /** How many pi processes may run at once. Busy threads can take it over. */
  readonly maxLive: number;
  /** How long an idle thread's pi keeps running once you leave the thread. */
  readonly idleMs: number;
}

export const POOL_LIMITS: PoolLimits = { maxLive: 4, idleMs: 10 * 60_000 };

export interface PoolDecision {
  /** The threads whose pi should stop now. */
  readonly stop: readonly string[];
  /** When a thread's pi would next time out, if any could. */
  readonly nextCheckAt: number | undefined;
}

/**
 * Picks the pi processes to stop among `members`, the threads with pi
 * running. It never stops the thread on screen or a busy one. Of the rest, it
 * stops those idle for `idleMs`, then the least recently used until at most
 * `maxLive` are left.
 */
export function choosePiToStop(
  members: readonly PoolMember[],
  now: number,
  limits: PoolLimits = POOL_LIMITS,
): PoolDecision {
  const stoppable = members
    .filter((member) => !member.visible && !member.busy)
    .toSorted((a, b) => a.lastUsed - b.lastUsed);
  const stop = stoppable.filter((member) => now - member.lastUsed >= limits.idleMs);
  let live = members.length - stop.length;
  for (const member of stoppable) {
    if (live <= limits.maxLive) break;
    if (stop.includes(member)) continue;
    stop.push(member);
    live--;
  }
  const kept = stoppable.find((member) => !stop.includes(member));
  return {
    stop: stop.map((member) => member.id),
    nextCheckAt: kept && kept.lastUsed + limits.idleMs,
  };
}
