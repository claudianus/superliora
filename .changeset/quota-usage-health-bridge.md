---
'@superliora/oauth': minor
'@superliora/sdk': patch
'@superliora/liora': patch
'@superliora/agent-core': patch
---

Skip exhausted Qwen/Alibaba token-plan providers in worker model routing.

Usage snapshots (TUI UsageMonitor / `getAllProvidersUsage`) now mark provider-level quota exhaustion on the shared credential health store (~1h cooldown) so `resolveSmartRoute` / subagent selection picks another healthy alias before a failed API call. Does not overwrite live `auth_rejected` records; clears when a later snapshot shows under-limit headroom.
