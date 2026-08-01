---
"@superliora/liora": minor
---

Speed up full compaction without lowering handoff quality: merge structured parallel block summaries deterministically (skip a merge LLM call), skip repair LLM when only evidence-id gaps remain, and start parallel summarize earlier with higher default concurrency.
