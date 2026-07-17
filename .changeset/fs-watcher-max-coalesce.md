---
"@superliora/liora": patch
---

Cap FS watch coalesce windows at 2s with truthful coalesced_window_ms so continuous file activity cannot starve event.fs.changed.
