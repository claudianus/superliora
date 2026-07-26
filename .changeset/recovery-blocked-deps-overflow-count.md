---
'@superliora/agent-core': patch
---

fix(agent-core): show overflow count in blocked-node dependsOn hints

`formatBlockedNodeNextActions` used to render `dependsOn: a, b, c, …`
when a blocked node had more than 3 dependencies, hiding the total
count. Recovery prompts now surface the overflow as `, … +N more` so
the operator can gauge the full scope of the dependency backlog
without inspecting the WorkGraph directly. The outer node-overflow
hint uses the same `+N more` convention.
