---
"@superliora/liora": patch
---

Fix transcript theme colors disappearing during agent work by parsing transcript ANSI at frame compose time and backfilling theme foreground on background-only cells.
