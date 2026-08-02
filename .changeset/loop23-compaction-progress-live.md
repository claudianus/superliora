---
'@superliora/protocol': patch
'@superliora/liora': patch
---

Keep live compaction progress updating without stage flicker: wire `blocksCompleted`/`fraction` through the event schema, paint progress ticks as content (not full layout), and pin the enter-beat to a single stable title line.
