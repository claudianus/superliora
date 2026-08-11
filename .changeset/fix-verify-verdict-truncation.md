---
"@superliora/liora": patch
---

Fix verify Jobs failing with `verdict=missing` after a real dual-axis pass: the harness now parses the full worker result before the summary size cap, and still reads truncated ```json``` verdict blocks.
