---
"@superliora/liora": patch
---

Tighten the kept-user message budget on small context windows so post-compaction context reliably settles below the auto-compaction trigger. Small windows (e.g. 64K) now cap kept-user messages at 15% of the window instead of 50%, preventing immediate re-compaction.
