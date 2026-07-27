---
"@superliora/agent-core": minor
---

Keep family-overflow clears recoverable (harness reform T1-4). When micro-compaction clears a tool result for `family_budget_overflow` and no archive id exists, the payload is now persisted under `<homedir>/tool-results/` and the marker carries a receipt (`receipt=`, `sha256=`, `captured_at=`, `summary1=`) with a line-ranged Read recovery hint, instead of destroying the output outright. Receipts are LRU-pruned to the newest 64. Archive-backed clears keep the existing LioraExpand path.
