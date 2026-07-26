---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/full-helpers.ts and full-policy.ts regression cases

- `full-policy.ts` — pins the recompact growth hysteresis (no baseline / no growth / minGrowthRatio off / working-set base on 1M windows), UltraSwarm deferral (active+!block, active+block, foreground children outside swarm), handoff threshold (missing/0/negative/cap-applied), observed-max relaxation (configured≤0, already at configured, decay overshoot guard), `resolveEffectiveMaxContextTokens`, `shouldRecoverFromOverflowStatus` (overflow, 413 below ratio, 413 above ratio, 413 with maxContext≤0), and `shouldUseParallelSummarize` (custom + default minMessages floors).
- `full-helpers.ts` — pins `extractCompactionSummary` (string / joined text parts / empty throws), `mergeTokenUsage` and `mergeTokenUsageOrNull` (null current, summed buckets, null next), `compactionSummaryMessage` (assistant + text part + empty toolCalls), `usageTelemetryProperties` (null + inputTotal split), `formatContextManagementCapability` (none, all-disabled, stable ordering), `emergencyBackstopWarnings` (off / on with documented message).
