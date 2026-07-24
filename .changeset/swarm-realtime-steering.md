---
'@superliora/liora': minor
---

Make UltraSwarm steering reach running children in real time. A steer issued during an UltraSwarm is now forwarded immediately to the currently-running child subagents (injected into their turns at the next step boundary, mirroring the main agent's steer), in addition to the existing phase-checkpoint steering that still covers children spawned afterward. Also aligns an expert-persona test assertion with the regenerated expert catalog content.
