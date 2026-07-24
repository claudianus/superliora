---
'@superliora/agent-core': minor
'@superliora/kosong': minor
'@superliora/liora': minor
---

Align the Qwen Cloud Token Plan integration with the current service catalog: six text models (adds qwen3.6-flash and glm-5.2) with context and max-output limits aligned to the Token Plan catalog (1M context for all six; max output 131,072 for qwen3.8-max-preview and glm-5.2, 65,536 for qwen3.7-max and qwen3.6-flash, 64,000 for qwen3.7-plus, 384,000 for deepseek-v4-pro), official harness tool identifiers (web_search, t2i_search, i2i_search, web_extractor, code_interpreter) gated per model with `enable_search` on Chat Completions, image generation model selection (wan2.7-image default, wan2.7-image-pro, qwen-image-2.0), and video generation with reference-to-video (happyhorse-1.1-r2v), first-frame `media[]` entries for image-to-video, and duration up to 15 seconds.
