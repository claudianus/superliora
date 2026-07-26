---
'@superliora/agent-core': patch
---

test(agent-core): pin session/swarm-budget.ts and ultra-swarm-restaff.ts regression cases

- `swarm-budget.ts` — pins the high-signal gates (evidenceIds, artifactIds, fileChangeCount, toolSuccessCount, verificationPassed) with the trim filter and the anti-gaming `productive`-only short-circuit; `isWastedBudgetRound` (empty, wasted+productive, wasted+high-signal override); `createSwarmBudgetState` (default 2, clamp ≥ 1); `recordSwarmBudgetRound` (consecutive reset, negative-counter clamp, last-label-overrides); `suggestSwarmBudgetKill` (continue reason below threshold, consecutive-wasted priority, last-round label suffix); `evaluateSwarmBudget` fold.
- `ultra-swarm-restaff.ts` — pins `needsRestaffing` (no gaps / no slots / any non-PASS / all PASS), `shouldPlanRestaffWave` (no-slot, force-true, soft-fallback to `needsRestaffing`), `collectRestaffGaps` (required+completed+non-PASS filter, result-vs-error fallback), `buildRestaffReflectionPrompt` (gap lines + optional bus digest), `filterRestaffPlan` (exclude + min(slots, 2) cap, sequential/parallel strategy switch), `restaffSlotsAvailable` (RESTAFF_MAX_NEW_EXPERTS = 2 cap), and `restaffPhaseForGaps` (implement/plan → implement, otherwise review).
