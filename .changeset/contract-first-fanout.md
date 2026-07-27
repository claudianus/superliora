---
"@superliora/agent-core": minor
---

Add a contract-first guard to subagent fan-out. The Agent and AgentSwarm tools accept an optional `contract` path (a shared types/events file both sides import); before any child is spawned, the host type-checks that contract with the owning package's `tsc --noEmit` (standalone file check when no package.json sits above it) and blocks the spawn with the compiler output when it fails. Conflicting contract changes between parallel agents are now caught by the compiler before work diverges instead of at integration time.
