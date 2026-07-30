import type { Agent } from '../..';
import {
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  PipelineStrategy,
  ToolCollapseStrategy,
  defaultAsyncTriggerRatioForWindow,
  defaultTriggerRatioForWindow,
  resolveCompactionBlockRatio,
  type CompactionStrategy,
} from '../strategy';

export function createDefaultFullCompactionStrategy(
  agent: Agent,
  getEffectiveMaxContextTokens: () => number,
  strategy?: CompactionStrategy,
): CompactionStrategy {
  if (strategy !== undefined) return strategy;

  const loopControl = agent.kimiConfig?.loopControl;
  const userTriggerRatio = loopControl?.compactionTriggerRatio;
  const userAsyncTriggerRatio = loopControl?.compactionAsyncTriggerRatio;
  const maxContextTokens = getEffectiveMaxContextTokens;
  const compactionBlockRatio = resolveCompactionBlockRatio(
    userTriggerRatio ?? DEFAULT_COMPACTION_CONFIG.triggerRatio,
    loopControl?.compactionBlockRatio,
  );
  const defaultTrigger = new DefaultCompactionStrategy(
    maxContextTokens,
    {
      ...DEFAULT_COMPACTION_CONFIG,
      get triggerRatio() {
        return userTriggerRatio ?? defaultTriggerRatioForWindow(maxContextTokens());
      },
      get asyncTriggerRatio() {
        return userAsyncTriggerRatio ?? defaultAsyncTriggerRatioForWindow(maxContextTokens());
      },
      get maxWorkingSetTokens() {
        return (
          loopControl?.maxWorkingSetTokens ??
          DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens
        );
      },
      get asyncWorkingSetTokens() {
        return (
          loopControl?.asyncWorkingSetTokens ??
          DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens
        );
      },
      blockRatio: compactionBlockRatio,
      reservedContextSize:
        loopControl?.reservedContextSize ??
        DEFAULT_COMPACTION_CONFIG.reservedContextSize,
      absoluteTriggerTokens:
        loopControl?.compactionTriggerTokens ??
        DEFAULT_COMPACTION_CONFIG.absoluteTriggerTokens,
      maxRecentMessages:
        loopControl?.compactionMaxRecentMessages ??
        DEFAULT_COMPACTION_CONFIG.maxRecentMessages,
      absoluteTriggerBlocks: false,
    },
  );
  return new PipelineStrategy([new ToolCollapseStrategy(2)], defaultTrigger);
}
