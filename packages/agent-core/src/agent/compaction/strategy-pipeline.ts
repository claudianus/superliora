import type { Message } from '@superliora/kosong';

import type { CompactionSource } from './types';
import {
  DEFAULT_COMPACTION_CONFIG,
  recompactGrowthBaseTokens,
} from './strategy-config';
import { DefaultCompactionStrategy } from './strategy-default';
import type { CompactionStrategy } from './strategy-types';

export class PipelineStrategy implements CompactionStrategy {
  constructor(
    private readonly strategies: readonly CompactionStrategy[],
    private readonly trigger: CompactionStrategy,
  ) {}

  shouldCompact(usedSize: number): boolean {
    return this.trigger.shouldCompact(usedSize);
  }

  shouldBlock(usedSize: number): boolean {
    return this.trigger.shouldBlock(usedSize);
  }

  shouldAsyncCompact(usedSize: number): boolean {
    return this.trigger.shouldAsyncCompact(usedSize);
  }

  computeCompactCount(messages: readonly Message[], source: CompactionSource): number {
    let count = this.trigger.computeCompactCount(messages, source);
    for (const strategy of this.strategies) {
      if (count <= 0) break;
      // 0 from a secondary strategy means "no additional constraint", not "compact nothing".
      const constrained = strategy.computeCompactCount(messages, source);
      if (constrained > 0) {
        count = Math.min(count, constrained);
      }
    }
    return count;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    let count = this.trigger.reduceCompactOnOverflow(messages);
    for (const strategy of this.strategies) {
      if (count <= 1) break;
      const constrained = strategy.reduceCompactOnOverflow(messages);
      if (constrained > 0) {
        count = Math.min(count, constrained);
      }
    }
    return count;
  }

  get checkAfterStep(): boolean {
    return this.trigger.checkAfterStep;
  }

  get maxCompactionPerTurn(): number {
    return this.trigger.maxCompactionPerTurn;
  }

  get maxOverflowCompactionAttempts(): number {
    return this.trigger.maxOverflowCompactionAttempts;
  }

  get asyncTriggerRatio(): number {
    return this.trigger.asyncTriggerRatio;
  }

  get frozenZoneSize(): number {
    return this.trigger.frozenZoneSize;
  }

  get parallelBlockThreshold(): number | undefined {
    return this.trigger.parallelBlockThreshold;
  }

  get parallelBlockTarget(): number | undefined {
    return this.trigger.parallelBlockTarget;
  }

  get parallelBlockConcurrency(): number | undefined {
    return this.trigger.parallelBlockConcurrency;
  }

  /** Forward to DefaultCompactionStrategy trigger when present (Pipeline-safe). */
  get speculativeStepBufferTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.speculativeStepBufferTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.speculativeStepBufferTokens;
  }

  get minRecompactGrowthRatio(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.minRecompactGrowthRatio;
    }
    return DEFAULT_COMPACTION_CONFIG.minRecompactGrowthRatio;
  }

  get workingSetBaseTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.workingSetBaseTokens;
    }
    return recompactGrowthBaseTokens({
      maxContextTokens: 0,
      maxWorkingSetTokens: DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens,
    });
  }

  get maxWorkingSetTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.maxWorkingSetTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens;
  }

  get asyncWorkingSetTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.asyncWorkingSetTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens;
  }

  shouldSpeculativelyCompact(projectedUsedSize: number): boolean {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.shouldSpeculativelyCompact(projectedUsedSize);
    }
    return this.trigger.shouldCompact(projectedUsedSize);
  }

  applyQualityFeedback(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
  }): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.applyQualityFeedback(input);
    }
    return 0;
  }
}
