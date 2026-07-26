---
'@superliora/agent-core': patch
---

test(agent-core): pin ultrawork/plan-phase.ts phase-inference regression cases

- `inferUltraPlanPhaseFromPlanContent` — pins the four-gate `exit` (Execution Plan + WorkGraph + Swarm decision + Verifiable UltraGoal / Acceptance Criteria / Verification Plan anchors), the `write` / `review` / `design` short-circuits, the case-insensitive swarm-decision match (ENGAGE/ADAPTIVE/DEFER), the rejection of a non-matching swarm decision (e.g. `maybe` falls back to `write`), the empty / whitespace-only `undefined` branch, and the no-recognised-heading `undefined` branch.
