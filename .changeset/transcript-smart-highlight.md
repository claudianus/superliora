---
'@superliora/liora': minor
---

Smart transcript highlighting for mixed tool and bash output

Rebuilt format detection so Read/Edit dumps, mixed bash streams, and bare code fences keep real syntax colour. Numbered Read lines strip gutters before tokenization, path hints drive language choice, and contiguous mixed segments (log + stack + JSON + code) each get their own highlighter without slowing the TUI hot path.
