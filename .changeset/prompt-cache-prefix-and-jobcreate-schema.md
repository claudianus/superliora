---
"@superliora/liora": patch
---

Spend fewer tokens per request: the Conductor operating playbook now sits inside the cacheable system-prompt prefix instead of the uncached trailing block, and the `JobCreate` schema no longer repeats the same guidance in every field description.
