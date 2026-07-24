---
'@superliora/liora': minor
---

Make long-session compaction and context caching more reliable.

- Compaction quality-check failure no longer stalls the session: criticals that survive repair swap in the deterministic extractive backstop and the turn resumes instead of freezing.
- Compaction trigger frequency is configurable (`compactionAsyncTriggerRatio`), and the quality-bias feedback can no longer ratchet compaction into a hair-trigger loop.
- Ultrawork runs always release Ultra Plan mode on completion, cancellation, or failure, so a finished or stalled run no longer re-locks plan mode on resume.
- Add a prompt-cache hit-rate metric (`UsageStatus.cacheHitRate`, surfaced through the usage status and telemetry) and remove the volatile bootstrap timestamp from the cached system prefix so the prefix stays byte-stable across turns.
