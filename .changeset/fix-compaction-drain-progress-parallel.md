---
'@superliora/agent-core': patch
'@superliora/protocol': patch
'@superliora/liora': patch
---

Fix large-session compaction crash on wire drain (`RangeError: Invalid string length`) by chunked JSONL writes; emit block-based `fraction`/`blocksCompleted` progress; adapt parallel block concurrency to rate limits (env `SUPERLIORA_COMPACTION_PARALLEL_CONCURRENCY`).
