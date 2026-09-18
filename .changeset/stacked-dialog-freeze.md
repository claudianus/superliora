---
"@superliora/liora": patch
---

Fix queued question and approval panels freezing the TUI: a mounted panel marked the editor busy, so every follow-up prompt deferred forever and Enter did nothing.
