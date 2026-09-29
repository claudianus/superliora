---
"@superliora/liora": patch
---

Keep subagent tool events responsive: an Edit chip no longer runs a 300×300 line diff on the event path, and a large tool payload is no longer fully stringified and whitespace-flattened to produce a 400-character preview.
