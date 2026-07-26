---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/strategy.ts regression cases

- Window-aware default ratios (`defaultTriggerRatioForWindow`, `defaultAsyncTriggerRatioForWindow`) — pins the small/large-window split at the documented 128k threshold and the async/sync ordering.
- Working-set / async / micro caps (`defaultMaxWorkingSetTokensForWindow`, `defaultAsyncWorkingSetTokensForWindow`, `defaultMicroWorkingSetTokensForWindow`) — pins the soft/async ordering and the disabled-on-small-window contract.
- `applyWorkingSetCap`, `recompactGrowthBaseTokens`, `microPressureThresholdTokens`, `resolveCompactionBlockRatio` — pins the cap-missing, floor, and ratio-fallback branches.
- `DefaultCompactionStrategy.shouldCompact` / `shouldBlock` / `shouldAsyncCompact` / `shouldSpeculativelyCompact` / `applyQualityFeedback` / `effectiveTriggerRatio` / `workingSetBaseTokens` — pins ratio threshold, working-set cap pull-down, async-only-between-thresholds, reserved-context block, quality-bias ratchet (0..0.02), and parallel-block ordering.
- `DEFAULT_COMPACTION_CONFIG` invariants — asyncTriggerRatio < triggerRatio, asyncWorkingSetTokens < maxWorkingSetTokens, blockRatio > triggerRatio, frozenZoneSize = 2, parallelBlockThreshold ≥ parallelBlockTarget.
