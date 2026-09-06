---
"@superliora/liora": minor
---

Model fallback is now opt-in: without `fallback_models` or `[models."alias".routing] auto_fallback` in config.toml, a failed request retries on the same model only instead of silently switching to other providers' models.

A cancelled turn no longer puts route candidates on cooldown, cooldowns after a failed request use per-failure-kind defaults (30s–60min) instead of a fixed 5-minute lockout, and each configured fallback candidate gets a real attempt.
