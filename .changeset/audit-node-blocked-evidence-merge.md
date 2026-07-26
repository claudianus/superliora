---
'@superliora/agent-core': patch
---

fix(agent-core): surface evidence-gate reasons in completion audit when both
`node_blocked` and done-without-evidence remap coexist. Previously the audit
returned `node_blocked` and silently dropped the evidence-gate work, leaving
recovery prompts without the evidence repair step. The rejection now merges
violation reasons, the evidence-gate repair action, and the remapped node
ids into the same `node_blocked` rejection so callers can drive both repair
tracks from one audit result.
