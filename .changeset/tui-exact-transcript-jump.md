---
"@superliora/liora": patch
---

Jump to the exact transcript line when navigating to an entry (from `/errors` or transcript search) instead of approximating with a fixed lines-per-entry heuristic. The viewport now resolves the target entry's first rendered line and scrolls precisely; the old heuristic remains as a fallback when layout information is unavailable.
