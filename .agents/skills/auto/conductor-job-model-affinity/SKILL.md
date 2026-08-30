---
name: conductor-job-model-affinity
description: "Pin JobCreate.model_alias from fleet_model_catalog live-healthy list and resolve ownership_paths overlap with affinity auto or continuation"
whenToUse: "Use when spawning Conductor JobCreate where model choice matters or when new job shares ownership_paths/context_paths with a running job"
triggers:
  - "JobCreate"
  - "model_alias"
  - "fleet_model_catalog"
  - "affinity"
  - "ownership_paths"
  - "continue_from_job_id"
  - "JobSteer"
  - "live-healthy"
type: prompt
source: auto
risk: low
---

# Conductor JobCreate — Healthy Model Pin + Affinity

1. **Read live-healthy list first.** Before any JobCreate, read `<fleet_model_catalog>` `Live-healthy aliases only`. Never invent an alias. The list in this trajectory was:
   ```
   opencode-go/qwen3.8-flash | 84 | 560 | 0.15 | yes | yes | 256k | ui/impl
   opencode-go/kimi-k3 | 99 | ...
   ```
2. **Pin model_alias explicitly from that list.** Set `JobCreate.model_alias` to a healthy alias that fits the kind (implement → quality/value). Working example:
   ```json
   {
     "context_paths": ["AGENTS.md", "packages/agent-core/AGENTS.md", "apps/liora/AGENTS.md", "docs"],
     "kind": "implement",
     "model_alias": "opencode-go/qwen3.8-flash",
     "ownership_paths": ["packages/agent-core", "packages/kosong", "packages/oauth", "apps/liora"],
     "title": "opencode Go/Zen 연동 초고도화 — 모델별 프로토콜 스마트 호환"
   }
   ```
   Returns `ACK job_mtf60cu71o78n6 [queued] ... model=opencode-go/qwen3.8-flash`
3. **Check overlap before spawning sibling.** Run `JobList` and compare `ownership_paths` / `context_paths` against any `running` job. Collision in this session: `packages/agent-core,packages/kosong,packages/oauth,apps/liora` vs `packages/server,packages/agent-core,apps/liora,packages/kosong` (3 paths overlap).
4. **On overlap, do not cold-spawn with affinity off.** If `affinity_hint` appears, switch to:
   ```json
   { "affinity": "auto", "continue_from_job_id": "job_mtf60cu71o78n6", ... }
   ```
   or use `JobSteer` on the running job. This queues as follow-up instead of racing the same worktree.
5. **If harness warns unhealthy, rotate — do not retry.** After a failed alias, pick the next healthy alias from current catalog (e.g., after `muse-spark` probe failures, moved to `qwen3.8-flash`). Never retry an omitted/failed alias until it reappears in the catalog.

**Done when:** `JobCreate` ACK shows `model=<alias from current live-healthy list>` and no `affinity_hint` warning; overlapping work is continued via `affinity="auto"` or `continue_from_job_id`/`JobSteer` instead of a cold sibling.

**What not to do:**
- Do not `JobCreate` with `model_alias` not in the current `<fleet_model_catalog>` (e.g., `opencode-go/gpt-5.6-luna` when unhealthy) — harness live-probes and rejects it.
- Do not omit `model_alias` hoping for deterministic routing when you need a specific family/value trade-off; pin from the list (omit → harness picks by kind/profile).
- Do not use `affinity="off"` or cold `JobCreate` when `ownership_paths` overlap a running job — causes `score=18 (paths=3, context=3...)` race warning.
- Do not retry a probe-failed alias (`muse-spark`, `gpt-5.6-luna`) until it reappears as live-healthy.
