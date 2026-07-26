---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-stagnation.ts and ultra-plan-ambiguity-heuristic.ts regression cases

- `ultra-plan-stagnation.ts` — pins `hashText` (deterministic, length-independent empty, distinct-input divergence); `detectSpinning` (need 3+ errors, identical trailing 3, non-identical rejection); `detectOscillation` (4-output minimum, ABAB trailing-4, monotonic pass-through); `detectNoDrift` (3-score minimum, 0.01 epsilon trailing-3, meaningful-drift pass-through); `detectDiminishingReturns` (4-score minimum, sub-0.01 avg trailing 3, healthy-curve pass-through); `detectAllStagnation` (the four documented patterns in stable order).
- `ultra-plan-ambiguity-heuristic.ts` — pins `clampClarity` (0..1), the documented `GOAL_CLARITY_FLOOR` / `CONSTRAINT_CLARITY_FLOOR` / `SUCCESS_CRITERIA_CLARITY_FLOOR` / `AMBIGUITY_THRESHOLD` constants, `floorFailures` (strict `<` for goal, `>` for constraint, strict `<` for success, 0/3 entries), `normalizeSectionName` (whitespace collapse + lower-case + underscore join), and `computeAmbiguityScoreHeuristic` (clamped outputs, no sections / non-verifiable / specificity 0, heuristic-fallback justifications, no-division-by-zero on empty rounds).
