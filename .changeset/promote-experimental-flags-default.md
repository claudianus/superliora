---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Promote the two remaining experimental flags to ship enabled by default: `auto_pilot` (the autonomous issue-to-PR pipeline command) and `anthropic_oauth` (the Anthropic Claude-subscription login option in the provider picker). Both stay overridable per environment with `SUPERLIORA_EXPERIMENTAL_AUTO_PILOT=0` and `SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=0`. Anthropic does not currently authorize third-party CLIs to reuse its subscription OAuth, so the Anthropic login may still be rejected after the callback; turn it off with `SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=0`. The experimental-flag gating guideline is retired: features ship on by default and flags remain only as per-environment kill switches.
