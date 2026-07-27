---
"@superliora/agent-core": minor
---

Add a rolling parent integration check for fan-out runs (harness reform T3-3d). After each batched subagent completion that changed files, the parent package is re-typechecked (`contract-check.ts` gains a file-less `checkPackageTypecheck`); failures are aggregated per run and appended as a `rolling_integration` warning to the AgentSwarm result, so cross-agent type leaks surface incrementally instead of at the final gate. Single-agent spawns keep zero overhead; infrastructure failures never block completions.
