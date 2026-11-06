/** A brief successful handshake is not evidence that a mobile connection recovered. */
export class RemoteBackoff {
  private failures = 0;
  private connectedAt: number | null = null;

  connected(now: number): void {
    this.connectedAt = now;
  }

  disconnected(now: number): void {
    if (this.connectedAt !== null && now - this.connectedAt >= 10_000) this.failures = 0;
    this.connectedAt = null;
  }

  delay(now: number): number {
    this.disconnected(now);
    const delay = Math.min(500 * 2 ** this.failures, 10_000);
    this.failures = Math.min(this.failures + 1, 5);
    return delay;
  }
}
