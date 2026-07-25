---
'@superliora/liora': minor
---

Cap agent working-set size on large context windows so auto-compaction starts near ~256k tokens instead of waiting until most of a 1M window is full. Micro clearing, async pre-rot, and recompact hysteresis use the same working-set base; hard overflow blocking still follows the model window. Set the policy from Settings → Context or `/context` (economy, balanced, deep, full). The footer shows a `ws:` badge and `/usage` adds a working-set gauge against the soft cap.
