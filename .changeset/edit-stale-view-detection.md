---
"@superliora/agent-core": minor
---

Detect stale views on Edit failures (harness reform T1-2). When `old_string` is not found and the target file's mtime is within the last ten minutes, the error now leads with a `STALE VIEW` notice explaining that the in-context Read output predates a session-time modification and that the caller must re-Read fresh bytes instead of retrying from memory. Older files keep the existing mtime hint and candidate suggestions.
