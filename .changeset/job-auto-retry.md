---
"@superliora/liora": patch
---

Workers that crash or fail to spawn now retry up to twice with backoff before the job is marked failed.
