---
"@superliora/agent-core": minor
---

Tighten Liora Recall injection precision (harness reform T2-5). The default per-turn injection cap drops from 6 to 2 and the default relevance floor rises from 0.2 to 0.35. Injection now fetches a wider candidate window, boosts governance/semantic memories so durable rules outrank marginal episodic hits before the cap applies, and renders episodic memories as subject-only summaries (full bodies stay in the store for explicit reads). Both knobs remain config-overridable via `maxRetrieved`/`minInjectionScore`.
