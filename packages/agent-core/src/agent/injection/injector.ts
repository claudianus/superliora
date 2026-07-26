import type { Agent } from '..';

export abstract class DynamicInjector {
  protected injectedAt: number | null = null;

  constructor(protected readonly agent: Agent) {}

  onContextClear(): void {
    this.injectedAt = null;
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

  protected abstract readonly injectionVariant: string;

  protected abstract getInjection(): string | Promise<string | undefined> | undefined;
}
