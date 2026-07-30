import type { Message } from '@superliora/kosong';

import type { CompactionSource } from '../types';

export interface CompactionStrategy {
  shouldCompact(usedSize: number): boolean;
  shouldBlock(usedSize: number): boolean;
  shouldAsyncCompact(usedSize: number): boolean;
  computeCompactCount(messages: readonly Message[], source: CompactionSource): number;
  reduceCompactOnOverflow(messages: readonly Message[]): number;
  readonly checkAfterStep: boolean;
  readonly maxCompactionPerTurn: number;
  readonly maxOverflowCompactionAttempts: number;
  readonly parallelBlockThreshold?: number;
  readonly parallelBlockTarget?: number;
  readonly parallelBlockConcurrency?: number;
  readonly minRecompactGrowthRatio?: number;
  readonly asyncTriggerRatio: number;
  readonly frozenZoneSize: number;
}
