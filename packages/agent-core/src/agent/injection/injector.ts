import type { Agent } from '..';

export abstract class DynamicInjector {
  protected injectedAt: number | null = null;
  private lastBatchContent: string | null = null;

  /**
   * Opt-in for cadence-free injectors whose content is a pure function of
   * state (capability banners, readiness cards): while the previously
   * injected copy is still live in the append-only history and the content
   * is byte-identical, the batch collector drops the re-send instead of
   * re-billing the same tail tokens on every step. Injectors with their own
   * refresh cadence (plan/ask/premium-quality sparse checkpoints) keep
   * control and must not enable this.
   */
  protected dedupeIdenticalBatchContent = false;

  constructor(protected readonly agent: Agent) {}

  onContextClear(): void {
    this.injectedAt = null;
    this.lastBatchContent = null;
  }

  onContextCompacted(compactedCount: number, keptHeadCount: number = 0): void {
    if (this.injectedAt !== null) {
      // The post-compaction history is
      //   [...keptMessages, summaryMessage, ...retainedSuffix]
      // so a retained tail message at original index N (N >= compactedCount)
      // moves to `keptMessages.length + 1 + (N - compactedCount)`. The
      // `+1` accounts for the new summary message; `keptHeadCount` is
      // passed in because the base class cannot know the head length.
      const newInjectedAt =
        this.injectedAt - compactedCount + 1 + keptHeadCount;
      this.injectedAt = newInjectedAt >= 0 ? newInjectedAt : null;
    }
  }

  onContextMessageRemoved(index: number): void {
    if (this.injectedAt === null) return;
    if (index < this.injectedAt) {
      this.injectedAt--;
    } else if (index === this.injectedAt) {
      this.injectedAt = null;
    }
  }

  async inject(): Promise<void> {
    const injection = await this.getInjection();
    if (injection) {
      this.injectedAt = this.agent.context.history.length;
      this.agent.context.appendSystemReminder(injection, {
        kind: 'injection',
        variant: this.injectionVariant,
      });
    }
  }

  /**
   * Collect this injector's contribution for a batched injection cycle.
   * Returns the injection text (triggering internal side effects like
   * deduplication tracking) without appending to the context. The caller
   * is responsible for calling {@link markBatchInjected} after appending.
   */
  async collectForBatch(): Promise<string | undefined> {
    const injection = await this.getInjection();
    if (injection === undefined) return undefined;
    if (this.dedupeIdenticalBatchContent) {
      // Skip only while the live anchor proves the identical copy is still in
      // history; compaction or removal nulls the anchor and re-triggers it.
      if (this.injectedAt !== null && injection === this.lastBatchContent) {
        return undefined;
      }
      this.lastBatchContent = injection;
    }
    return injection;
  }

  /** Mark this injector as having participated in a batch append at `index`. */
  markBatchInjected(index: number): void {
    this.injectedAt = index;
  }

  protected abstract readonly injectionVariant: string;

  protected abstract getInjection(): string | Promise<string | undefined> | undefined;
}
