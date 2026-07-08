---
"@superliora/liora": patch
---

Expire tool-call ids held for late-arriving results once the compaction that orphaned them has moved past their prefix, and log when a tool ignores its abort signal past the grace timeout instead of leaving the leaked work invisible.
