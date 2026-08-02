---
'@superliora/agent-core': patch
'@superliora/liora': patch
---

Maker≠Checker hard gate runs before AgentSwarm queue and UltraSwarm phase spawn (not after discarding results). Hard rejects return `isError: true` so sensors treat the fan-out as failed.
