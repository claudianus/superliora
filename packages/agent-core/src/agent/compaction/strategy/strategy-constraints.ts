import type { Message } from '@superliora/kosong';

import type { CompactionSource } from '../types';
import { canSplitAfter } from './strategy-split';
import type { CompactionStrategy } from './strategy-types';

export class ToolCollapseStrategy implements CompactionStrategy {
  /**
   * Keep the last N tool-call groups fully intact (observation masking).
   * Default 2 retains the current exchange plus one prior group so the model
   * can still ground on the immediately previous tool result (context-engineering
   * keep-window practice; JetBrains observation masking).
   *
   * NOTE: `computeCompactCount` returns 0 when there is nothing older to
   * collapse. PipelineStrategy treats 0 as "no additional constraint".
   * Live tool-result clearing remains owned by MicroCompaction (usage-primary);
   * this strategy only bounds how far full compaction may cut into recent tool groups.
   */
  constructor(
    private readonly keepRecentToolGroups: number = 2,
  ) {}

  shouldCompact(): boolean { return true; }
  shouldBlock(): boolean { return false; }
  shouldAsyncCompact(): boolean { return false; }
  checkAfterStep = false;
  maxCompactionPerTurn = Infinity;
  maxOverflowCompactionAttempts = 3;
  asyncTriggerRatio = 0;
  frozenZoneSize = 0;

  computeCompactCount(messages: readonly Message[], _source: CompactionSource): number {
    let toolGroupsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'assistant' && m.toolCalls.length > 0) {
        toolGroupsSeen++;
        if (toolGroupsSeen > this.keepRecentToolGroups) {
          let end = i;
          for (let j = i + 1; j < messages.length && messages[j]!.role === 'tool'; j++) {
            end = j;
          }
          return end + 1;
        }
      }
    }
    return 0;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    return this.computeCompactCount(messages, 'auto');
  }
}

export class SlidingWindowStrategy implements CompactionStrategy {
  constructor(
    private readonly keepLastGroups: number = 20,
  ) {}

  shouldCompact(): boolean { return true; }
  shouldBlock(): boolean { return false; }
  shouldAsyncCompact(): boolean { return false; }
  checkAfterStep = false;
  maxCompactionPerTurn = Infinity;
  maxOverflowCompactionAttempts = 3;
  asyncTriggerRatio = 0;
  frozenZoneSize = 0;

  computeCompactCount(messages: readonly Message[], _source: CompactionSource): number {
    let groupsKept = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'system') {
        groupsKept++;
        if (groupsKept >= this.keepLastGroups) {
          for (let j = i - 1; j >= 0; j--) {
            if (canSplitAfter(messages, j)) {
              return j + 1;
            }
          }
          return i;
        }
      }
    }
    return 0;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    return this.computeCompactCount(messages, 'auto');
  }
}
