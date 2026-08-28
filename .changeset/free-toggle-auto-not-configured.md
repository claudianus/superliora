---
"@superliora/liora": patch
---

Fix FREE mode after `/free off` → `/free on` throwing `Model "auto" is not configured` on the next prompt: turn-time smart-auto fallback now resolves to the concrete free alias (clearing stale probe cooldowns) instead of leaving the virtual `auto` pin unresolved, side LLM calls (prompt suggestions, ghost text) stop resolving auth against `auto`, and stale free-model aliases are actually deleted from config.toml on `/free on` and at startup (the previous prune wrote a patch the deep-merge API cannot apply).
