/**
 * Input → JobCreate ACK latency instrumentation (V3-1).
 *
 * The Conductor job desk's responsiveness contract is measured from the
 * operator's input submission (`MessageDispatchController.sendMessageInternal`
 * → `ControlTowerJobDesk.markInputSubmitted`) to the first Conductor job
 * event that reaches the desk (`job.updated`, or a Job* tool-output backfill
 * that changes the board). The tracker keeps a bounded sample window and
 * answers the p95 budget question (≤ 1s); it never blocks or mutates the
 * input path itself.
 */

/** p95 budget for input submission → first JobCreate ACK. */
export const INPUT_ACK_P95_BUDGET_MS = 1_000;

const DEFAULT_MAX_SAMPLES = 256;

/** Percentile (nearest-rank) of a sample list; undefined when empty. */
export function p95Ms(samples: readonly number[]): number | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

export interface InputAckLatencyStats {
  readonly count: number;
  readonly lastMs: number | undefined;
  readonly maxMs: number | undefined;
  readonly p95Ms: number | undefined;
  /** True when p95 ≤ {@link INPUT_ACK_P95_BUDGET_MS} (vacuously true with no samples). */
  readonly withinP95Budget: boolean;
}

export class InputAckLatencyTracker {
  private pendingInputAtMs: number | undefined;
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  constructor(options: { readonly maxSamples?: number } = {}) {
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  }

  /** Open (or restart, last-write-wins) the window at input-submission time. */
  markInputSubmitted(atMs: number): void {
    this.pendingInputAtMs = atMs;
  }

  /**
   * Close the window at the first job event after input. Returns the
   * recorded delay, or undefined when no window was open (job event without
   * a preceding submission — normal for events from other actors).
   */
  markJobEventReceived(atMs: number): number | undefined {
    const startMs = this.pendingInputAtMs;
    if (startMs === undefined) return undefined;
    this.pendingInputAtMs = undefined;
    const delayMs = Math.max(0, atMs - startMs);
    this.samples.push(delayMs);
    while (this.samples.length > this.maxSamples) this.samples.shift();
    return delayMs;
  }

  /** True while a submission waits for its first job event. */
  get pending(): boolean {
    return this.pendingInputAtMs !== undefined;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  samplesSnapshot(): readonly number[] {
    return [...this.samples];
  }

  stats(): InputAckLatencyStats {
    const p95 = p95Ms(this.samples);
    const maxMs = this.samples.length === 0 ? undefined : Math.max(...this.samples);
    return {
      count: this.samples.length,
      lastMs: this.samples.length === 0 ? undefined : this.samples[this.samples.length - 1]!,
      maxMs,
      p95Ms: p95,
      withinP95Budget: p95 === undefined || p95 <= INPUT_ACK_P95_BUDGET_MS,
    };
  }

  reset(): void {
    this.pendingInputAtMs = undefined;
    this.samples.length = 0;
  }
}
