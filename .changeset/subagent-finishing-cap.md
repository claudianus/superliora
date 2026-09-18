---
"@superliora/liora": patch
---

Subagent and job workers that go silent in their finishing phase now return a diagnostic result after a ten-minute idle cap instead of burning the whole wall-clock deadline.
