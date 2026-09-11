---
"@superliora/liora": patch
---

Cut runaway session logs and CPU: coalesce job-ledger wire records to one snapshot per window, cap steer note/prompt tails, and make subagent progress telemetry incremental instead of rescanning the full history every tick.
