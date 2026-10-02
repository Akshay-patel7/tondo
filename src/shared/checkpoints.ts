/** One Tondo run, including steering and follow-ups consumed before agent_settled. */
export interface CheckpointTurn {
  readonly turn: number;
  readonly startedAt: number;
  readonly state: "running" | "capturing" | "ready" | "unavailable";
  readonly reason: string | null;
}

export interface CheckpointFile {
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
  readonly binary: boolean;
  readonly patch: string;
}

export type CheckpointDiff =
  | { readonly files: readonly CheckpointFile[]; readonly error: null }
  | { readonly files: readonly []; readonly error: string };
