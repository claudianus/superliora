---
"@superliora/liora": patch
---

Restore tool-result budgets and tighten context-overflow recovery so sessions cannot grow past the real provider prompt limit. Large tool outputs spill to disk with a receipt and head/tail preview instead of staying fully in context; 400s such as "maximum prompt length is N" re-arm compaction against the stated ceiling.
