---
"@superliora/liora": patch
---

Stop silent freezes across the agent loop: abort hung model stream opens, ignore empty stream keepalives, time out FetchURL/MCP tool calls, keep thinking/waiting clocks ticking, and surface stalled timers.
