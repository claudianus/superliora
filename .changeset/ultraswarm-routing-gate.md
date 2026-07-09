---
"@superliora/liora": minor
---

Add adaptive routing for UltraSwarm so task complexity controls staffing intensity. Plans can now declare `Swarm decision: ADAPTIVE` with `Swarm intensity: light|standard|heavy`; the swarm launches fewer experts for moderate work and skips the swarm entirely for simple tasks. The UltraSwarm progress panel shows the routing decision and intensity. Review intensity also drives multi-lens critic assignment (spec-strict / adversarial / edge-case) with weighted consensus instead of a single fail-any rule.
