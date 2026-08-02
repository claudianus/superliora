---
"@superliora/liora": patch
---

Stop the TUI from freezing when rapidly scrolling the transcript up and down by making pure-scroll paints cache-or-placeholder only and deferring heavy invalidation until scroll settles.
