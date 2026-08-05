---
"@superliora/agent-core": minor
---

Tighten Liora Memory injection precision (harness reform T2-5). The default per-turn injection cap drops from 6 to 2 and the default relevance floor rises from 0.2 to 0.35. Injection now fetches a wider candidate window, boosts rule/fact memories so durable rules outrank marginal event hits before the cap applies, and renders event memories as subject-only summaries (full bodies stay in the store for explicit reads). Both knobs remain config-overridable via `maxRetrieved`/`minInjectionScore`.
