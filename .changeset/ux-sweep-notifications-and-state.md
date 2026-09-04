---
"@superliora/liora": patch
---

Honor the notification settings on every notification path: turn-complete bells, error toasts, and job-outcome alerts now respect the `[notifications]` toggle and the unfocused condition instead of ringing on every turn regardless of the setting. Switching or creating a session also clears the previous session's cost, model-failover badge, intervention counters, and cache meter so a fresh session no longer shows stale numbers.
