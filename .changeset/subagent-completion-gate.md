---
"@superliora/agent-core": minor
---

Run a scoped completion gate when a subagent finishes: if its change set is confined to one workspace package, the host executes that package's test/typecheck/lint scripts (via the RunProjectChecks engine, 180s per check, 10m ceiling) and records passed/failed/not_run verdicts plus a verification_failed flag on the result contract; read-only profiles and ambiguous scopes skip the gate
