---
"@superliora/agent-core": minor
---

Extend file leases to every spawned subagent. Each child now gets a lease identity (owner/run), so concurrent edits from parallel agents conflict-check through the existing Edit/Write guard instead of silently clobbering each other. The Agent tool accepts an optional `ownership` list of file paths: they are claimed at spawn, an overlap with another owner blocks fan-out with the holder's identity, and all claims release when the child completes or fails. UltraSwarm keeps its own run-scoped leasing unchanged.
