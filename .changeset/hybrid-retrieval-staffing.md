---
"@superliora/liora": minor
---

Upgrade SearchExpert/SearchSkill to hybrid retrieval (MiniSearch + local ultra-light embeddings with real cosine/RRF; Granite-97M ONNX when available, feature-hash degraded offline). `retrieval:build` precomputes expert and skill passage vectors. Conductor JobCreate staffs task/implement/explore via SearchExpert by default — high-score experts bind into worker prompts, low scores fall back to generic. VerifySurface reports load/interaction/craft axes; stop sensor forces one VerifySurface re-entry when UI paths stay unproven. Implement/task completion auto-enqueues an independent review Job (Maker≠Checker); MergeJob hard-rejects without a passed review child or when implement and review share an expertId.
