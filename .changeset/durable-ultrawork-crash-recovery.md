---
"@superliora/liora": minor
---

Make Ultrawork (and all tool side effects) survive a hard crash or power loss and resume from the exact interruption point.

File writes now land atomically (temp + fsync + rename) so a crash mid-write can no longer leave a source file torn or truncated. Every side-effecting tool call (file edits/writes, Bash) is wrapped in a durable intent log that is fsync'd before the side effect runs; after a crash, resume verifies whether the write already landed instead of silently redoing it or assuming it never ran. Interrupted tool calls now report the intended path so the agent re-reads before retrying.

The wire-log journal is the single source of truth: Ultrawork run-state mirrors are written atomically and carry a journal append-offset, stage transitions flush synchronously, and resume keeps the journal authoritative over a stale on-disk mirror. Signal handlers (SIGINT/SIGTERM/SIGHUP) and uncaught-exception paths now drain pending records to disk before the process dies.
