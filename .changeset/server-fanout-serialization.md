---
"@superliora/liora": patch
---

Send one copy of each gateway event per broadcast instead of re-serializing it for every connected client, and stop rebuilding the per-connection send context on every frame.