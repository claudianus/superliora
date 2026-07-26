---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/{ultra-plan-mode drift helpers, ultra-swarm-decision} regression cases

- `combinedDrift` / `isDriftAcceptable` / `ULTRA_PLAN_DRIFT_THRESHOLD` / `ULTRA_PLAN_DRIFT_THRESHOLD_AUTO` — pin the 0.5 / 0.3 / 0.2 weighting (zero metrics → 0, fully-divergent → 1), the strict-threshold accept / reject boundary, and the auto-threshold band (auto threshold > strict threshold, but `isDriftAcceptable` always uses the strict one).
- `ultraSwarmDecision` — pin the case-insensitive `swarm decision: <X>` line (ENGAGE / ADAPTIVE / DEFER), the `Decision: <X>` fallback line (list bullet, numeric item, bold), the no-decision `undefined` return, and the unknown-value `undefined` return.
- `ultraSwarmEngageNextAction` — pin the non-ENGAGE `undefined` return, the seeded ENGAGE next-action line (with the comma-joined `work_node_ids` and the "Capability Coverage Matrix" instruction), the unseeded ENGAGE next-action line (with the "Pass relevant UltraworkGraph work_node_ids after seeding the graph" instruction), the default-unseeded shape when the seeded argument is omitted, and the DEFER-with-waiver escape-hatch mention.
