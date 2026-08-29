---
"@superliora/liora": patch
---

Warm sessions now keep their model across smart-route role switches, and route ordering prefers the warmed provider prefix on ties — switching aliases would destroy the prompt cache and cost more than it saves. Disable with SUPERLIORA_EXPERIMENTAL_CACHE_STICKY_ROUTING=false.
