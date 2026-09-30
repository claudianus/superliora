---
"@superliora/liora": patch
---

Stop re-serializing every tool schema several times per step when the context budget is computed, which lowers CPU on each agent turn.