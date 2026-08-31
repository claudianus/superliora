---
'@superliora/agent-core': minor
'@superliora/liora': patch
---

Scope worker model selection to user-selected models: non-auto sessions no longer roam the provider catalog for worker/job models (explicit role models, then the session model), catalog recommendation surfaces (fleet card, Still-live lists) follow the same pool, fresh main-lane traffic now outweighs stale credential-health marks at spawn gates, per-model 403 region/entitlement rejections stay alias-scoped instead of poisoning the shared credential, and live probes give reasoning-capable models completion headroom so thinking-first upstreams no longer read as empty.
