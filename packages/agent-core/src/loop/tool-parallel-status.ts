/** Live parallel tool-call counters synced from {@link ToolScheduler}. */
export interface ToolParallelSnapshot {
  readonly parallelToolsInFlight: number;
  readonly maxParallelTools?: number;
}

export class ToolParallelStatus {
  private inFlight = 0;
  private maxParallel = 0;

  sync(inFlight: number, maxParallel: number): void {
    this.inFlight = Math.max(0, inFlight);
    if (maxParallel > this.maxParallel) this.maxParallel = maxParallel;
  }

  clearTurn(): void {
    this.inFlight = 0;
  }

  snapshot(): ToolParallelSnapshot {
    return {
      parallelToolsInFlight: this.inFlight,
      ...(this.maxParallel > 0 ? { maxParallelTools: this.maxParallel } : {}),
    };
  }
}
