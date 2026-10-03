import type { CheckpointDiff, CheckpointTurn } from "../shared/checkpoints";
import { captureCheckpoint, checkpointFiles, checkpointRoot, hasCheckpoint } from "./checkpoints";
import type { Store, StoredCheckpoint } from "./store";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Orders Git around pi. Prompt preparation finishes before the host sends RPC. */
export class TurnCheckpoints {
  private records: StoredCheckpoint[];
  private prepared: StoredCheckpoint | undefined;
  private active: StoredCheckpoint | undefined;
  private preparing: Promise<void> | undefined;
  private finishing: Promise<void> = Promise.resolve();
  private readonly pending = new Set<number>();
  private readonly overlapping = new Set<number>();

  private readonly store: Store;
  private readonly threadId: string;
  private readonly project: string;
  private readonly changed: () => void;

  constructor(store: Store, threadId: string, project: string, changed: () => void) {
    this.store = store;
    this.threadId = threadId;
    this.project = project;
    this.changed = changed;
    this.records = store.checkpoints(threadId);
    // A dead host cannot establish when the files stopped changing. Do not
    // capture today's checkout and claim it was yesterday's completion.
    for (const record of this.records) {
      if (record.state === "running" || record.state === "capturing") {
        this.save(
          {
            ...record,
            state: "unavailable",
            reason: "Tondo stopped before this turn's checkpoint finished.",
          },
          false,
        );
      }
    }
  }

  get turns(): readonly CheckpointTurn[] {
    return this.records.map(({ turn, startedAt, state, reason: message }) => ({
      turn,
      startedAt,
      state,
      reason: message,
    }));
  }

  get busy(): boolean {
    return this.active !== undefined || this.preparing !== undefined || this.pending.size > 0;
  }

  /** Steering shares the active turn. An idle prompt waits for the previous capture. */
  async prepare(): Promise<void> {
    await this.finishing;
    if (this.active) return;
    if (this.preparing) return this.preparing;
    this.preparing = this.prepareOnce().finally(() => {
      if (this.records.some((record) => record.turn === this.prepared?.turn))
        this.prepared = undefined;
      this.preparing = undefined;
    });
    return this.preparing;
  }

  private async prepareOnce(): Promise<void> {
    const record = this.next();
    this.prepared = undefined;
    try {
      const root = await checkpointRoot(this.project);
      if (!root) {
        this.prepared = {
          ...record,
          reason: "This folder is not a Git checkout. No baseline was captured.",
        };
        return;
      }
      if (!(await hasCheckpoint(root, this.threadId, record.turn - 1))) {
        await captureCheckpoint(root, this.threadId, record.turn - 1);
      }
      this.prepared = { ...record, root, baseline: true, reason: null };
    } catch (error) {
      this.prepared = { ...record, reason: `Baseline checkpoint failed: ${reason(error)}` };
    }
  }

  /** agent_start can repeat during retries; agent_settled is the closing boundary. */
  started(): void {
    if (this.active) return;
    // Extensions can start work without a host prompt. RPC events cannot pause
    // them, so a pending snapshot cannot claim a clean completion boundary.
    for (const turn of this.pending) this.overlapping.add(turn);
    this.active = this.prepared ?? this.next();
    this.prepared = undefined;
    this.save(this.active);
  }

  /** Called after settled, or after pi and its tools have exited. */
  settled(): void {
    const record = this.active;
    if (!record) return;
    this.active = undefined;
    this.pending.add(record.turn);
    this.save({ ...record, state: "capturing" });
    this.finishing = this.finishing.then(() => this.finish(record));
  }

  async drain(): Promise<void> {
    await this.preparing;
    await this.finishing;
  }

  async diff(turn: number): Promise<CheckpointDiff> {
    const record = this.records.find((item) => item.turn === turn);
    if (!record) return { files: [], error: "This thread has no such checkpoint turn." };
    if (record.state !== "ready" || !record.root || !record.baseline) {
      return { files: [], error: record.reason ?? "This turn's checkpoint is not ready." };
    }
    try {
      return {
        files: await checkpointFiles(record.root, this.threadId, turn - 1, turn),
        error: null,
      };
    } catch (error) {
      return { files: [], error: reason(error) };
    }
  }

  private async finish(record: StoredCheckpoint): Promise<void> {
    try {
      const root = await checkpointRoot(this.project);
      if (!root) {
        this.save({
          ...record,
          state: "unavailable",
          reason: "This folder is not a Git checkout. Turn diffs need Git.",
        });
        return;
      }
      // Git can be initialized during a turn. Keep its completion for the next
      // turn, but never manufacture the missing before-image from HEAD.
      await captureCheckpoint(root, this.threadId, record.turn);
      const boundaryError = this.overlapping.has(record.turn)
        ? "Pi started another run before the completion checkpoint finished."
        : record.reason;
      const available = record.baseline && record.root === root && boundaryError === null;
      this.save({
        ...record,
        root,
        state: available ? "ready" : "unavailable",
        reason: available ? null : (boundaryError ?? "No baseline was captured before this turn."),
      });
    } catch (error) {
      this.save({
        ...record,
        state: "unavailable",
        reason: `Completion checkpoint failed: ${reason(error)}`,
      });
    } finally {
      this.pending.delete(record.turn);
      this.overlapping.delete(record.turn);
      this.changed();
    }
  }

  private next(): StoredCheckpoint {
    return {
      turn: (this.records.at(-1)?.turn ?? 0) + 1,
      startedAt: Date.now(),
      state: "running",
      reason: "No baseline was captured before this turn.",
      root: null,
      baseline: false,
    };
  }

  private save(record: StoredCheckpoint, notify = true): void {
    this.store.saveCheckpoint(this.threadId, record);
    this.records = [...this.records.filter((item) => item.turn !== record.turn), record].toSorted(
      (a, b) => a.turn - b.turn,
    );
    if (notify) this.changed();
  }
}
