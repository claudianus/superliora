---
"@superliora/liora": patch
---

Fix two TypeScript errors that broke the SDK declaration build: wrap the first-request resolve so the turn's `TurnEndResult` is discarded before reaching the void-typed gate, and narrow both swap operands in the staleness sample helper.
