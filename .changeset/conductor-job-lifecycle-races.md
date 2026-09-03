---
"@superliora/liora": patch
---

Fix job lifecycle races and steering guards surfaced by multi-job Conductor simulations: worker completion no longer overwrites terminal ledger verdicts, spawn-budget expiry and agent-less pumps no longer resurrect or promote cancelled jobs, interrupted-resume bursts keep the successor worker's abort handle, JobSteer rejects terminal and worker-less running status forces, ownership overlap now covers nested paths, inbox trimming keeps unread notices, and the idle pulse reports in the session language instead of hardcoded Korean.
