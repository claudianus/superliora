---
"@superliora/agent-core": patch
---

**UltraSwarm boundary budget**

- Raise `SWARM_TOTAL_RESULT_MAX_CHARS` from 1_000 to **6_000** so multi-expert integration reports keep the root `<ultra_swarm_result>` envelope and handoff tags after archive compaction.
