---
'@superliora/liora': minor
---

Add a `transcript_detail` appearance preference (`minimal | compact | standard | full`, default `standard`) as the groundwork for the 4-level transcript density model, and raise the standard per-tool preview from 3 to 5 highlighted lines. Codify real-time formatting/highlighting for all transcript output as a mandatory TUI guideline (AGENTS.md + PREMIUM.md self-check). Fail fast on expired subscriptions and revoked credentials: permanent auth/billing errors (HTTP 401/403, "subscription expired", invalid API key, suspended accounts) are no longer retried, so subagents surface an actionable error instead of hanging on a dead provider.
