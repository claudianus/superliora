---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Keep compaction from freezing the session when the summarizer API hangs or fails. Each compaction generate call now has a wall-clock deadline and a tighter stream idle budget; the whole worker has a hard timeout; timeouts, connection drops, and exhausted retries fall back to the extractive summary; merge/repair soft-fail instead of hard-stalling; and `block()` always releases a stuck compaction lock. Provider overflow observations still tighten the effective window, but unstated tiny estimates are floored so short fixtures cannot thrash multi-round compaction under a synthetic ~100-token ceiling.
