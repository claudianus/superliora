---
'@superliora/agent-core': patch
'@superliora/liora': patch
---

Emit a one-shot CACHE_FREEZE_DRIFT wire warning when CacheFreezeGuard soft-detects mid-turn tool-list drift, and show a named TUI notice (status counters alone were easy to miss live).
