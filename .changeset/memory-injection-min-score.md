---
'@superliora/liora': minor
---

Make recalled-memory injection relevance-aware. When matching memories against the current prompt, injection now applies a conservative minimum relevance score (default 0.2, configurable via `minInjectionScore`) so clearly-irrelevant memories are no longer injected; the no-query path and the score weighting are unchanged.
