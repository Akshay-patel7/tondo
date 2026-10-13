/** A host-offered update. The page sends only its id back, never an executable or package source. */
export interface PiUpdate {
  readonly id: string;
  readonly name: string;
  readonly scope: "pi" | "user" | "project";
  readonly source: string;
  readonly installed: string | null;
  readonly latest: string | null;
  readonly state: "available" | "current" | "pinned" | "local" | "unavailable";
  readonly message: string | null;
}

export interface PiUpdates {
  readonly entries: readonly PiUpdate[];
  readonly checking: boolean;
  /** Includes stopping pi, installing, refreshing inventory and restoring the visible thread. */
  readonly updating: boolean;
  readonly applying: string | null;
  readonly error: string | null;
  readonly checkedAt: number | null;
  readonly project: string | null;
}

export const NO_PI_UPDATES: PiUpdates = {
  entries: [],
  checking: false,
  updating: false,
  applying: null,
  error: null,
  checkedAt: null,
  project: null,
};
