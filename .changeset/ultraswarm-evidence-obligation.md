---
"@superliora/agent-core": minor
---

Enforce the evidence obligation in UltraSwarm reports (harness reform T4-7b). `hasCitedEvidence` recognizes evidence/artifact ids, changed file paths, `file:line` citations, and test/log artifacts; completed expert results without any citation are flagged `evidence="missing"` per agent, counted as `missing_evidence` in the report overview, and surfaced in the headline so unevidenced PASS claims are visible instead of trusted.
