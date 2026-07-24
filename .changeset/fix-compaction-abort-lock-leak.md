---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Fix auto-compaction deadlocking the agent at the trigger threshold. When a compaction round was interrupted by an abort that did not go through `cancel()` — a provider timeout, a linked signal, or a pre/post-compact hook — the worker exited without releasing its lock. `compacting` then stayed set forever: `checkAutoCompaction()` short-circuited, every new prompt and steer buffered in the turn, and the session froze at the threshold (typically 70%) with no way to recover. The compaction worker now releases the lock in a `finally` guard whenever it still owns it, so an interrupted compaction always cleans up and the next turn proceeds. `cancel()`-initiated aborts are unaffected because `cancel()` clears the lock synchronously before the worker observes the abort.
