---
"@superliora/liora": patch
---

Clean up legacy prompt plumbing: the legacy-list skill prompt mode now renders as search (old configs still parse), system prompt template variables are canonical SUPERLIORA_* with KIMI_* kept as aliases for custom profiles, and bundled subagent profiles share one base preamble instead of three copies.
