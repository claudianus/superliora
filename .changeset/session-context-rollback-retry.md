---
"@superliora/liora": patch
---

Stop re-appending the user prompt on every provider-failure retry, which inflated the context with duplicate messages and skewed model input after a failed turn.
