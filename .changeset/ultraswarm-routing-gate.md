---
"@superliora/liora": minor
---

Add adaptive routing for UltraSwarm so task complexity controls staffing intensity. Plans can now declare `Swarm decision: ADAPTIVE` with `Swarm intensity: light|standard|heavy`; the swarm launches fewer experts for moderate work and skips the swarm entirely for simple tasks. The UltraSwarm progress panel shows the routing decision and intensity.
