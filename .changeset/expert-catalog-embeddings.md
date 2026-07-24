---
'@superliora/liora': minor
---

Activate semantic (RRF) expert selection for UltraSwarm. The bundled expert catalog now ships 384-dim embedding vectors for every expert (regenerated via the catalog build with @huggingface/transformers, now a dev-only dependency used only to regenerate the catalog), so the expert search engine's existing embedding + reciprocal-rank-fusion hybrid ranker is active instead of falling back to lexical-only BM25 matching. This improves auto-selected expert relevance.
