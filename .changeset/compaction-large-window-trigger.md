---
'@superliora/liora': minor
---

Make auto-compaction less frequent on large context windows. When no explicit `compactionTriggerRatio`/`compactionAsyncTriggerRatio` is configured and the context window is large (>=128k tokens, e.g. 131k), the default trigger ratios now start later (sync 0.70->0.80, async 0.55->0.70), clamped safely below the block-ratio ceiling. Small windows and explicit user configuration are unchanged.
