---
"@superliora/agent-core": patch
---

fix(agent-core): surface per-node category hints in failed-node recovery actions

`formatFailedNodeNextActions` previously capped the `analyzeFailedNodes` category
guidance at two entries while listing up to three node ids, silently dropping
the category/guidance for the third listed node (and any further failed nodes
collapsed under `+N more`). When several failed nodes had different repair
categories (e.g. timeout vs. integration-verify), the agent only saw the first
two hints and could mis-prioritise repair. Each listed node now carries its own
`id[category]: guidance` line so every visible entry in the recovery action is
self-describing; the `+N more` overflow stays at the global cap of three.
