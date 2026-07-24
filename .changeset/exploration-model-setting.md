---
'@superliora/liora': minor
---

Add an `explorationModel` loop-control setting. Read-only exploration subagents now honor an explicitly configured `explorationModel` alias (checked before the auto-inferred cheap model and the parent model), mirroring the existing `compactionModel`/`completionModel` override pattern so users can pin the model used for code exploration.
