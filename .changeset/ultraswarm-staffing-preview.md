---
"@superliora/agent-core": minor
---

Make UltraSwarm staffing auditable (harness reform T4-7a). Every expert spec now carries a non-empty selection reason — catalog-provided rationale is kept, and auto-selected experts without one get a default citing phase/lane and division. `renderUltraSwarmResults` emits a `<staffing>` preview block (expert, phase, lane, reason) ahead of the per-expert bodies, complementing the pre-spawn `ultrawork.team.staffed` event so the parent sees who was staffed and why before reading results.
