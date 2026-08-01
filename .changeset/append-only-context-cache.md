---
"@superliora/liora": minor
---

Remove micro-compaction and automatic tool-output truncation/compression so conversation history stays append-only and prompt-cache hit rates stay high. Tool results keep full content; context pressure uses full compaction only.
