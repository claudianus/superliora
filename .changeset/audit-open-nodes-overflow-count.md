---
'@superliora/agent-core': patch
---

fix(agent-core): cap Open nodes list in completion-audit rejection

`formatCompletionAuditRejection` joined every open node id into a
single line, which could blow up the recovery prompt on large
WorkGraphs. The renderer now shows the first 8 ids and a `+N more`
overflow marker, matching the `formatBlockedNodeNextActions` and
`formatEvidenceHardGateNextActions` convention. The full id list is
still available programmatically on the rejection payload.
