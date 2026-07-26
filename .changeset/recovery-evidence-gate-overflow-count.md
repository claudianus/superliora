---
'@superliora/agent-core': patch
---

fix(agent-core): show +N more on evidence hard-gate overflow

`formatEvidenceHardGateNextActions` used to render `…, …` when more
than 3 nodes failed the evidence hard gate, hiding the total count.
The recovery prompt now surfaces the overflow as `, … +N more` to
match the `formatBlockedNodeNextActions` convention so the operator
can gauge the full scope of the evidence-gate backlog at a glance.
