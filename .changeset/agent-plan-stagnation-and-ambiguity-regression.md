---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-stagnation + ambiguity-heuristic regression cases

- `hashText`, `detectSpinning`, `detectOscillation`, `detectNoDrift`,
  `detectDiminishingReturns`, `detectAllStagnation` cover hashing,
  short-input guards, threshold logic, and aggregate result shape.
- `clampClarity`, `floorFailures`, `normalizeSectionName`,
  `computeAmbiguityScoreHeuristic` cover clamping, floor checks,
  whitespace normalization, conservative empty-interview defaults, and
  bounded clarities for all-user-origin rounds.
