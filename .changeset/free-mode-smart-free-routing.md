---
"@superliora/liora": minor
---

Add FREE mode for model routing: set `free_mode = true` in config.toml or run `/free on` to route every role (coding, planning, exploration, compaction, completion, debugging, and Smart Auto main session) to free-tier models only. Selection remains benchmark-aware (models.dev coding benches, quality/value scores, tier/context filters) — not a dumb cheapest-price pick — and relaxes strict quality floors only to pick the best available free candidate. Use `/free status`/`/free off` or `free_mode = false` to restore standard routing; enabling FREE auto-switches a paid pinned default_model to `auto` so the main turn also uses free.
