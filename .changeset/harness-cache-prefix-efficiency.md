---
"@superliora/liora": minor
---

Keep the cached prompt prefix stable across swarm workers and long sessions: per-worker role text now rides outside the shared cached prefix, stale swarm results are masked once when they land instead of on every rebuild, injected reminder batches are capped, and duplicated tool-schema and language instructions are sent only once.
