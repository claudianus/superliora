---
"@superliora/liora": minor
---

Archive compacted tool exchanges to the context-archive store so the original command/output content stays recoverable via `liora-expand` after compaction, instead of being lost to the summary. Compacted tool-exchange groups are now archived and referenced from the compaction summary; everything else is summarized in place as before.
